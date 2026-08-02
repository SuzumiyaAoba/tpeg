#!/usr/bin/env bun
/**
 * tpeg -- generate a TypeScript parser from a .tpeg grammar file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { offsetToPos, parse } from "@suzumiyaaoba/tpeg-core";
import {
  applyAstOptimizations,
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  tpegFile,
} from "@suzumiyaaoba/tpeg-parser";

const USAGE = `Usage: tpeg <input.tpeg> [options]

Parses a .tpeg grammar file (a "grammar Name { ... }" block, optionally
followed by one or more "transforms Name@typescript { ... }" blocks) and
generates a standalone TypeScript parser.

Options:
  -o, --output <path>       Write generated code to this file (default: stdout)
      --name-prefix <name>  Prefix every generated parser export with <name>
      --optimize            Use the performance-optimized code generator
                             (also enables FIRST-set predictive dispatch by
                             default -- see --ast-optimize for rewrites
                             that stay opt-in)
      --ast-optimize         Rewrite the grammar before code generation:
                             left-factor shared alternative prefixes, merge
                             adjacent character classes, and degenerate
                             "!x ." negative-lookahead pairs into a negated
                             character class. Off by default because left-
                             factoring's safety check does not look past an
                             ancestor rule's own semantic action reading the
                             factored rule's value shape -- review generated
                             output for grammars with actions before relying
                             on this in production.
      --no-types            Omit "Parser<T>" type annotations from output
  -h, --help                Show this help message
  -v, --version             Show the CLI version

Examples:
  tpeg grammar.tpeg -o parser.ts
  tpeg grammar.tpeg --optimize --name-prefix my_ > parser.ts
  tpeg grammar.tpeg --optimize --ast-optimize > parser.ts
`;

interface CliOptions {
  output?: string;
  namePrefix?: string;
  optimize: boolean;
  astOptimize: boolean;
  types: boolean;
  help: boolean;
  version: boolean;
}

function parseCliArgs(argv: string[]): {
  options: CliOptions;
  positionals: string[];
} {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      output: { type: "string", short: "o" },
      "name-prefix": { type: "string" },
      optimize: { type: "boolean", default: false },
      "ast-optimize": { type: "boolean", default: false },
      "no-types": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });

  return {
    options: {
      ...(values.output !== undefined ? { output: values.output } : {}),
      ...(values["name-prefix"] !== undefined
        ? { namePrefix: values["name-prefix"] }
        : {}),
      optimize: values.optimize ?? false,
      astOptimize: values["ast-optimize"] ?? false,
      types: !(values["no-types"] ?? false),
      help: values.help ?? false,
      version: values.version ?? false,
    },
    positionals,
  };
}

function readVersion(): string {
  const url = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
  return pkg.version;
}

export function run(argv: string[]): number {
  const { options, positionals } = parseCliArgs(argv);

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (options.version) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  const inputPath = positionals[0];
  if (!inputPath) {
    process.stderr.write("error: missing required <input.tpeg> argument\n\n");
    process.stderr.write(USAGE);
    return 1;
  }

  let source: string;
  try {
    source = readFileSync(inputPath, "utf8");
  } catch (error) {
    process.stderr.write(
      `error: could not read "${inputPath}": ${(error as Error).message}\n`,
    );
    return 1;
  }

  const parseResult = parse(tpegFile)(source);
  if (!parseResult.success) {
    const { message, pos, expected, found } = parseResult.error;
    const { line, column } = offsetToPos(source, pos);
    process.stderr.write(
      `error: failed to parse "${inputPath}" at line ${line}, column ${column}: ${message}\n`,
    );
    if (expected) {
      const expectedList = Array.isArray(expected)
        ? expected.join(", ")
        : expected;
      process.stderr.write(`  expected: ${expectedList}\n`);
    }
    if (found) {
      process.stderr.write(`  found: ${found}\n`);
    }
    return 1;
  }

  // `applyAstOptimizations` (left-factoring, character-class merging,
  // negative-lookahead degeneration -- see packages/parser/src/ast-optimize.ts)
  // runs ahead of code generation, independently of which generator is
  // chosen below: it rewrites the grammar's AST, not the emitted code.
  const grammar = options.astOptimize
    ? applyAstOptimizations(parseResult.val)
    : parseResult.val;

  const generate = options.optimize
    ? generateOptimizedTypeScriptParser
    : generateTypeScriptParser;
  const generated = generate(grammar, {
    includeTypes: options.types,
    ...(options.namePrefix !== undefined
      ? { namePrefix: options.namePrefix }
      : {}),
  });

  if (options.output) {
    writeFileSync(options.output, generated.code, "utf8");
    process.stderr.write(
      `wrote ${generated.exports.length} parser(s) to ${options.output}\n`,
    );
  } else {
    process.stdout.write(generated.code);
    if (!generated.code.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }

  return 0;
}

if (import.meta.main) {
  process.exit(run(process.argv.slice(2)));
}

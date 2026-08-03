#!/usr/bin/env bun
/**
 * tpeg -- generate a TypeScript parser from a .tpeg grammar file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { offsetToPos, parse } from "@suzumiyaaoba/tpeg-core";
import {
  analyzeFirstSets,
  applyAstOptimizations,
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  insertAutomaticCuts,
  promoteGlobalCuts,
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
      --regex-fusion         Compile non-terminal-free rules to a single
                             regexFused(...) call instead of a combinator
                             tree (see packages/core/src/regex-fused.ts).
                             Requires --optimize. Off by default pending
                             more real-world grammar coverage.
      --auto-cut             Insert cut/commit at provably safe positions
                             in ordered choices (see
                             packages/parser/src/ast-optimize.ts's
                             insertAutomaticCuts). Applied after
                             --ast-optimize's rewrites, if both are given.
                             Off by default: this is a more cautious
                             opt-in than --ast-optimize's rewrites.
      --promote-cuts         Mark every provably-safe cut (see
                             packages/parser/src/ast-optimize.ts's
                             promoteGlobalCuts) so it compiles to
                             commitAtTopLevel instead of the ordinary,
                             purely-local commit, letting @memoize'd rules
                             discard now-unreachable cache entries.
                             Applied after --auto-cut, if both are given
                             (a cut has to exist before it can be
                             promoted) -- a no-op without --auto-cut and no
                             hand-written "~" in the source grammar.
      --no-types            Omit "Parser<T>" type annotations from output
  -h, --help                Show this help message
  -v, --version             Show the CLI version

Examples:
  tpeg grammar.tpeg -o parser.ts
  tpeg grammar.tpeg --optimize --name-prefix my_ > parser.ts
  tpeg grammar.tpeg --optimize --ast-optimize > parser.ts
  tpeg grammar.tpeg --optimize --regex-fusion --auto-cut > parser.ts
`;

interface CliOptions {
  output?: string;
  namePrefix?: string;
  optimize: boolean;
  astOptimize: boolean;
  regexFusion: boolean;
  autoCut: boolean;
  promoteCuts: boolean;
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
      "regex-fusion": { type: "boolean", default: false },
      "auto-cut": { type: "boolean", default: false },
      "promote-cuts": { type: "boolean", default: false },
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
      regexFusion: values["regex-fusion"] ?? false,
      autoCut: values["auto-cut"] ?? false,
      promoteCuts: values["promote-cuts"] ?? false,
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

  if (options.regexFusion && !options.optimize) {
    process.stderr.write(
      "error: --regex-fusion requires --optimize (the standard generator has no such option)\n",
    );
    return 1;
  }

  // `applyAstOptimizations` (left-factoring, character-class merging,
  // negative-lookahead degeneration -- see packages/parser/src/ast-optimize.ts)
  // and `insertAutomaticCuts` both run ahead of code generation,
  // independently of which generator is chosen below: they rewrite the
  // grammar's AST, not the emitted code. `insertAutomaticCuts` runs AFTER
  // `applyAstOptimizations` deliberately -- left-factoring can turn a
  // choice's alternatives into disjoint-prefixed sequences that only then
  // become cut candidates, so running cuts second finds a superset of the
  // cut sites running them first would.
  const astOptimized = options.astOptimize
    ? applyAstOptimizations(parseResult.val)
    : parseResult.val;
  const cutInserted = options.autoCut
    ? insertAutomaticCuts(astOptimized)
    : astOptimized;
  // `promoteGlobalCuts` (packages/parser/src/ast-optimize.ts, Pillar 7 of
  // the perf plan) needs a FIRST-set analysis of the SAME grammar it's
  // marking cuts in -- computed fresh here rather than reusing whatever
  // `insertAutomaticCuts` used internally, since `--ast-optimize`/
  // `--auto-cut` may have already changed the rule set.
  const grammar = options.promoteCuts
    ? promoteGlobalCuts(cutInserted, analyzeFirstSets(cutInserted)).grammar
    : cutInserted;

  // Split into two explicit branches rather than picking a shared
  // `generate` function: `enableRegexFusion` only exists on
  // `OptimizedCodeGenOptions`, and with `exactOptionalPropertyTypes` on,
  // a single call site typed against the union of both option shapes
  // can't forward it.
  const sharedOptions = {
    includeTypes: options.types,
    ...(options.namePrefix !== undefined
      ? { namePrefix: options.namePrefix }
      : {}),
  };
  const generated = options.optimize
    ? generateOptimizedTypeScriptParser(grammar, {
        ...sharedOptions,
        ...(options.regexFusion ? { enableRegexFusion: true } : {}),
      })
    : generateTypeScriptParser(grammar, sharedOptions);

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

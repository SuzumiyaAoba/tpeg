#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type GrammarDefinition,
  type Parser,
  offsetToPos,
  parse,
} from "@suzumiyaaoba/tpeg-core";
import {
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  skipTrailingWhitespaceAndComments,
  tpegModuleFile,
} from "@suzumiyaaoba/tpeg-parser";

/**
 * Code Generation Demo: .tpeg grammar -> TypeScript parser -> run it
 *
 * Demonstrates the full generation pipeline:
 * 1. Read a `.tpeg` grammar file from disk
 * 2. Parse it into a GrammarDefinition AST (the same front end the
 *    `tpeg` CLI uses)
 * 3. Generate standalone TypeScript parsers -- both the standard and the
 *    performance-optimized generators
 * 4. Write them under `generated/` (committed, so the checked-in output
 *    is inspectable and the spec suite can import it statically)
 * 5. Dynamically import the generated module and evaluate expressions
 *
 * The equivalent one-shot CLI command is:
 *   bun run packages/cli/src/cli.ts calc.tpeg -o calc.generated.ts
 *   bun run packages/cli/src/cli.ts calc.tpeg --optimize -o calc.opt.ts
 */

// `import.meta.dir` would be the Bun shorthand; fileURLToPath keeps this
// runnable anywhere ESM is supported.
const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_PATH = join(HERE, "calc.tpeg");
const GENERATED_DIR = join(HERE, "generated");

/**
 * Reads a `.tpeg` file and returns its grammar AST.
 *
 * `tpegModuleFile` (not `tpegFile`) is what the CLI parses with -- it also
 * accepts leading `import "..."` statements. `parse()` only requires a
 * prefix match, so the trailing-content check mirrors the CLI's: anything
 * left over after the grammar/transforms blocks is reported as an error
 * at its line/column rather than silently dropped.
 */
const loadGrammar = (path: string): GrammarDefinition => {
  const source = readFileSync(path, "utf8");
  const result = parse(tpegModuleFile)(source);
  const fullyConsumed =
    result.success &&
    skipTrailingWhitespaceAndComments(source, result.next) === source.length;

  if (!result.success || !fullyConsumed) {
    const offset = result.success ? result.next : result.error.pos;
    const { line, column } = offsetToPos(source, offset);
    const message = result.success
      ? `unexpected content after line ${line}, column ${column}`
      : `line ${line}, column ${column}: ${result.error.message}`;
    throw new Error(`failed to parse ${path}: ${message}`);
  }

  // `tpegModuleFile` returns a ModularGrammarDefinition carrying
  // module-only fields (imports/exports) the generators don't consume --
  // hand them the plain GrammarDefinition, exactly like the CLI does.
  const mod = result.val;
  return {
    type: "GrammarDefinition",
    name: mod.grammar.name,
    annotations: mod.grammar.annotations,
    rules: mod.grammar.rules,
    ...(mod.grammar.transforms !== undefined
      ? { transforms: mod.grammar.transforms }
      : {}),
  };
};

/**
 * Generates both parser variants and writes them under `generated/`.
 * Returns the file paths written.
 */
const generate = (grammar: GrammarDefinition): string[] => {
  mkdirSync(GENERATED_DIR, { recursive: true });

  const variants = [
    {
      file: "calc.generated.ts",
      generated: generateTypeScriptParser(grammar, {}),
    },
    {
      file: "calc.optimized.generated.ts",
      generated: generateOptimizedTypeScriptParser(grammar, {}),
    },
  ];

  const written: string[] = [];
  for (const { file, generated } of variants) {
    for (const warning of generated.warnings) {
      console.warn(`   ⚠ ${file}: ${warning}`);
    }
    const path = join(GENERATED_DIR, file);
    writeFileSync(
      path,
      generated.code.endsWith("\n") ? generated.code : `${generated.code}\n`,
    );
    written.push(path);
    console.log(
      `   📄 ${file} -- ${generated.exports.length} export(s): ${generated.exports.join(", ")}`,
    );
  }
  return written;
};

/**
 * Dynamically imports a freshly written generated module. `bun` (and the
 * vitest runner) can import TypeScript directly; the generated file's own
 * `@suzumiyaaoba/tpeg-core` import resolves through this package's
 * workspace dependency.
 */
const importGenerated = async (
  path: string,
): Promise<Record<string, Parser<unknown>>> => {
  return (await import(pathToFileURL(path).href)) as Record<
    string,
    Parser<unknown>
  >;
};

const demoGenerate = (grammar: GrammarDefinition) => {
  console.log("⚙️  Generating TypeScript parsers...");
  const written = generate(grammar);
  console.log();
  return written;
};

const demoRun = async (paths: string[]) => {
  const expressions = [
    "1 + 2 * 3",
    "(1 + 2) * 3",
    "-5 + 3 * (2 - 1)",
    "3.14 * 2",
    "  8\n  -\t3  ", // whitespace anywhere -- the @skip: ws annotation
  ];
  const malformed = ["1 +", "(1 + 2", "1 . 5"];

  for (const path of paths) {
    const name = path.split("/").pop();
    console.log(`=== Running generated/${name} ===`);

    const module = await importGenerated(path);
    // `start` is the stable alias for the grammar's @start rule -- a
    // consumer never has to know the rule is actually called `top`.
    const entry = module["start"];
    if (entry === undefined) {
      console.log("   ⚠ no `start` export -- falling back to `expression`");
    }
    const start = entry ?? module["expression"];
    if (start === undefined) {
      throw new Error(`generated module ${name} has no usable entry point`);
    }

    for (const expr of expressions) {
      const result = parse(start)(expr);
      if (result.success) {
        console.log(
          `   ${JSON.stringify(expr)}  =>  ${JSON.stringify(result.val)}`,
        );
      } else {
        console.log(
          `   ${JSON.stringify(expr)}  =>  ERROR: ${result.error.message}`,
        );
      }
    }

    for (const expr of malformed) {
      const result = parse(start)(expr);
      console.log(
        `   ${JSON.stringify(expr)}  =>  ${
          result.success
            ? `parsed ${JSON.stringify(result.val)} (unexpected)`
            : "rejected (expected)"
        }`,
      );
    }
    console.log();
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const generateOnly = args.includes("--generate-only");

  console.log("🎯 TPEG Code Generation Demo\n");
  console.log(`📝 Grammar: ${GRAMMAR_PATH}`);

  const grammar = loadGrammar(GRAMMAR_PATH);
  console.log(
    `✅ Parsed grammar "${grammar.name}" -- ${grammar.rules.length} rule(s), ${grammar.annotations.length} annotation(s)`,
  );
  for (const rule of grammar.rules) {
    console.log(`   • ${rule.name}`);
  }
  console.log();

  const written = demoGenerate(grammar);

  if (generateOnly) {
    console.log("✅ Regeneration complete (--generate-only).");
    return;
  }

  await demoRun(written);

  console.log("💡 Equivalent CLI usage:");
  console.log("   bun run packages/cli/src/cli.ts \\");
  console.log("     packages/samples/src/codegen/calc.tpeg \\");
  console.log(
    "     -o packages/samples/src/codegen/generated/calc.generated.ts",
  );
  console.log("   # add --optimize for the performance-optimized generator");
  console.log();
  console.log("✅ Demo completed successfully!");
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  }
}

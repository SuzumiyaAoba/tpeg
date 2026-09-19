#!/usr/bin/env bun

/**
 * TPEG Samples - Main Entry Point
 *
 * This file provides a unified interface to run all TPEG parser samples.
 * Each sample demonstrates different parsing capabilities and use cases.
 */

import { join } from "node:path";

const showHelp = () => {
  console.log(`
🎯 TPEG Parser Samples

Available samples:
  arith    - Arithmetic expression parser with AST and direct calculation
  csv      - CSV parser with header support and data conversion
  json     - JSON parser with comprehensive type support
  peg      - PEG meta-grammar parser demonstration
  ini      - INI config file parser (sections, comments, round-trip)
  sexpr    - S-expression parser (recursive lists, quote sugar)
  url      - URL parser (scheme/authority/path/query/fragment)
  codegen  - Generate a TypeScript parser from a .tpeg grammar file

Usage:
  bun run samples [sample-name]
  bun run samples --help

Examples:
  bun run samples arith    # Run arithmetic calculator demo
  bun run samples csv      # Run CSV parser demo
  bun run samples json     # Run JSON parser demo
  bun run samples peg      # Run PEG grammar demo
  bun run samples ini      # Run INI parser demo
  bun run samples sexpr    # Run S-expression parser demo
  bun run samples url      # Run URL parser demo
  bun run samples codegen  # Run code generation demo
  bun run samples          # Show this help

Individual sample commands:
  bun run arith            # Arithmetic calculator
  bun run arith:repl       # Interactive arithmetic REPL
  bun run csv              # CSV parser demo
  bun run json             # JSON parser demo
  bun run peg              # PEG grammar demo
  bun run ini              # INI parser demo
  bun run sexpr            # S-expression parser demo
  bun run url              # URL parser demo
  bun run codegen          # .tpeg -> TypeScript parser demo
`);
};

// Each demo script guards its entry point behind `import.meta.main`,
// so `await import("./json/demo")` from here loaded the module but never
// RAN its demo (#93). Spawn the script directly instead -- that makes it
// the main module again, keeps each demo's own argv handling working,
// and lets extra args (`bun run samples arith --ast "1+2"`) forward.
const SAMPLE_SCRIPTS: Record<string, readonly [string, string]> = {
  arith: ["🧮 Running Arithmetic Calculator Demo...", "arith/demo.ts"],
  arithmetic: ["🧮 Running Arithmetic Calculator Demo...", "arith/demo.ts"],
  csv: ["📊 Running CSV Parser Demo...", "csv/demo.ts"],
  json: ["🟢 Running JSON Parser Demo...", "json/demo.ts"],
  peg: ["📝 Running PEG Grammar Demo...", "peg/demo.ts"],
  ini: ["⚙️ Running INI Config Parser Demo...", "ini/demo.ts"],
  sexpr: ["🧬 Running S-expression Parser Demo...", "sexpr/demo.ts"],
  url: ["🔗 Running URL Parser Demo...", "url/demo.ts"],
  codegen: ["🏗️ Running Code Generation Demo...", "codegen/demo.ts"],
};

const runSample = (sampleName: string, sampleArgs: string[]) => {
  const entry = SAMPLE_SCRIPTS[sampleName.toLowerCase()];
  if (!entry) {
    console.error(`❌ Unknown sample: ${sampleName}`);
    console.log("Use --help to see available samples");
    process.exit(1);
  }

  const [header, script] = entry;
  console.log(`${header}\n`);

  // `process.execPath` is the running Bun binary; the demo .ts files
  // aren't executable on their own.
  const result = Bun.spawnSync(
    [process.execPath, join(import.meta.dir, script), ...sampleArgs],
    {
      stdio: ["inherit", "inherit", "inherit"],
    },
  );
  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
};

const runAllSamples = () => {
  console.log("🎯 Running All TPEG Samples\n");

  // `codegen` is deliberately left out of --all: it regenerates files
  // under src/codegen/generated/ as part of its demonstration, which is
  // more side effect than the read-only demos above carry.
  const samples = ["arith", "csv", "json", "peg", "ini", "sexpr", "url"];

  for (const sample of samples) {
    console.log(`\n${"=".repeat(60)}`);
    runSample(sample, []);
    console.log(`${"=".repeat(60)}\n`);
  }

  console.log("✅ All samples completed successfully!");
};

const main = () => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  if (args.includes("--all")) {
    runAllSamples();
    return;
  }

  const sampleName = args[0];
  if (sampleName === undefined) {
    showHelp();
    return;
  }
  runSample(sampleName, args.slice(1));
};

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error("❌ Unexpected error:", error);
    process.exit(1);
  }
}

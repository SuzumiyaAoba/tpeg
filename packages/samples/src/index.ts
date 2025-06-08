#!/usr/bin/env bun

/**
 * TPEG Samples - Main Entry Point
 *
 * This file provides a unified interface to run all TPEG parser samples.
 * Each sample demonstrates different parsing capabilities and use cases.
 */

const showHelp = () => {
  console.log(`
🎯 TPEG Parser Samples

Available samples:
  arith    - Arithmetic expression parser with AST and direct calculation
  csv      - CSV parser with header support and data conversion
  json     - JSON parser with comprehensive type support
  peg      - PEG meta-grammar parser demonstration

Usage:
  bun run samples [sample-name]
  bun run samples --help

Examples:
  bun run samples arith    # Run arithmetic calculator demo
  bun run samples csv      # Run CSV parser demo
  bun run samples json     # Run JSON parser demo
  bun run samples peg      # Run PEG grammar demo
  bun run samples          # Show this help

Individual sample commands:
  bun run arith            # Arithmetic calculator
  bun run arith:repl       # Interactive arithmetic REPL
  bun run csv              # CSV parser demo
  bun run json             # JSON parser demo
  bun run peg              # PEG grammar demo
`);
};

const runSample = async (sampleName: string) => {
  try {
    switch (sampleName.toLowerCase()) {
      case "arith":
      case "arithmetic":
        console.log("🧮 Running Arithmetic Calculator Demo...\n");
        await import("./arith/demo");
        break;

      case "csv":
        console.log("📊 Running CSV Parser Demo...\n");
        await import("./csv/demo");
        break;

      case "json":
        console.log("📋 Running JSON Parser Demo...\n");
        await import("./json/demo");
        break;

      case "peg":
        console.log("📝 Running PEG Grammar Demo...\n");
        await import("./peg/demo");
        break;

      default:
        console.error(`❌ Unknown sample: ${sampleName}`);
        console.log("Use --help to see available samples");
        process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Failed to run sample '${sampleName}':`, error);
    process.exit(1);
  }
};

const runAllSamples = async () => {
  console.log("🎯 Running All TPEG Samples\n");

  const samples = ["arith", "csv", "json", "peg"];

  for (const sample of samples) {
    console.log(`\n${"=".repeat(60)}`);
    await runSample(sample);
    console.log(`${"=".repeat(60)}\n`);
  }

  console.log("✅ All samples completed successfully!");
};

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  if (args.includes("--all")) {
    await runAllSamples();
    return;
  }

  const sampleName = args[0];
  await runSample(sampleName);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Unexpected error:", error);
    process.exit(1);
  });
}

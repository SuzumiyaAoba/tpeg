#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatedSource, loadGrammar } from "./tpeg-utils";

/**
 * Regenerates every sample's `.tpeg` grammar twin.
 *
 * Each sample directory keeps a checked-in generated parser at
 * `generated/<name>.generated.ts` so the file is inspectable and
 * statically importable from specs. Running this script re-emits all
 * of them from their `.tpeg` sources -- do it whenever a grammar file
 * or the generator itself changes (the `tpeg.spec.ts` freshness tests
 * fail if the committed output drifts).
 *
 * The `codegen` sample is NOT covered here -- its demo has its own
 * `--generate-only` mode that emits both the standard and optimized
 * variants it showcases.
 *
 * Usage: bun run regen            (from packages/samples)
 *        bun run src/tpeg-regen.ts (from anywhere in the package)
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const GRAMMARS: readonly { grammar: string; output: string }[] = [
  { grammar: "arith/arith.tpeg", output: "arith/generated/arith.generated.ts" },
  { grammar: "csv/csv.tpeg", output: "csv/generated/csv.generated.ts" },
  { grammar: "json/json.tpeg", output: "json/generated/json.generated.ts" },
  { grammar: "ini/ini.tpeg", output: "ini/generated/ini.generated.ts" },
  { grammar: "sexpr/sexpr.tpeg", output: "sexpr/generated/sexpr.generated.ts" },
  { grammar: "url/url.tpeg", output: "url/generated/url.generated.ts" },
];

const main = () => {
  console.log("🔄 Regenerating .tpeg sample twins...\n");

  for (const { grammar, output } of GRAMMARS) {
    const grammarPath = join(HERE, grammar);
    const outputPath = join(HERE, output);

    const definition = loadGrammar(grammarPath);
    const source = generatedSource(definition);

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, source);
    console.log(`   📄 ${grammar} -> ${output}`);
  }

  console.log("\n✅ All twins regenerated.");
};

main();

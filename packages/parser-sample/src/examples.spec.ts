import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
/**
 * Example-grammar regression coverage: every `examples/*.tpeg` file is
 * parsed, run through BOTH code generators, the generated module is
 * compiled/loaded, and each grammar that ships a `*-samples.txt` /
 * `*-inputs.txt` file is exercised against every sample input in it.
 *
 * This exists because several example grammars previously could not parse
 * their own shipped samples at all -- e.g. `scheme = "http" / "https"`
 * rejected every `https://` URL (ordered choice commits to the first
 * matching alternative, so the shorter prefix won and the following
 * `"://"` failed), `host = [a-zA-Z0-9]` matched a single character, and
 * `calculator.tpeg`/`json-lite.tpeg` declared whitespace handling that
 * was never wired into the expression/object rules. Nothing executed the
 * grammars against their sample inputs, so the defects were invisible.
 */
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { parse } from "@suzumiyaaoba/tpeg-core";
import {
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  grammarDefinition,
} from "@suzumiyaaoba/tpeg-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, "..", "examples");

/** Grammar file -> samples file -> entry rule exported by the generated module. */
const SAMPLE_PAIRS = [
  { grammar: "url.tpeg", samples: "url-samples.txt", entry: "url" },
  { grammar: "email.tpeg", samples: "email-samples.txt", entry: "email" },
  { grammar: "ini.tpeg", samples: "ini-samples.txt", entry: "ini" },
  { grammar: "csv.tpeg", samples: "csv-samples.txt", entry: "csv" },
  { grammar: "log.tpeg", samples: "log-samples.txt", entry: "log" },
  {
    grammar: "calculator.tpeg",
    samples: "calculator-inputs.txt",
    entry: "expression",
  },
  { grammar: "json-lite.tpeg", samples: "json-inputs.txt", entry: "value" },
] as const;

/**
 * calculator-inputs.txt's "## Error Cases" section lists inputs that must
 * NOT fully parse -- either an outright failure or a partial prefix match
 * (`1 +` consumes `1` and leaves ` +`, since the grammar has no EOF
 * assertion). Everything else must consume the entire line.
 */
const CALCULATOR_ERROR_CASES = new Set(["1 +", "(1 + 2", "1 + 2)", "1 ++ 2"]);

/** One sample per non-comment line; "##" sections are headers too. */
const lineSamples = (file: string): string[] => {
  const raw = readFileSync(join(EXAMPLES_DIR, file), "utf-8");
  // json-inputs.txt's trailing "## Complex Example" block is a single
  // multi-line document, tested separately via documentSamples().
  const complexIdx = raw.indexOf("## Complex Example");
  const head = complexIdx >= 0 ? raw.slice(0, complexIdx) : raw;
  return head
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
};

/**
 * Whole-document inputs for grammars whose samples file is itself one
 * document (INI/CSV/LOG) plus json-inputs.txt's multi-line complex example.
 * For INI the "# ..." lines are valid comment content and stay; CSV/LOG
 * treat "# ..." lines as file headers and drop them.
 */
const documentSamples = (file: string): string[] => {
  const raw = readFileSync(join(EXAMPLES_DIR, file), "utf-8");
  const docs: string[] = [];
  if (file === "ini-samples.txt") {
    docs.push(
      raw
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .join("\n"),
    );
  } else if (file === "csv-samples.txt" || file === "log-samples.txt") {
    docs.push(
      raw
        .split("\n")
        .filter((l) => l.trim().length > 0 && !l.trim().startsWith("#"))
        .join("\n"),
    );
  } else if (file === "json-inputs.txt") {
    const idx = raw.indexOf("## Complex Example");
    if (idx >= 0) {
      docs.push(raw.slice(idx).split("\n").slice(1).join("\n").trim());
    }
  }
  return docs.filter((d) => d.length > 0);
};

const exampleGrammars = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".tpeg"))
  .sort();

describe("examples/*.tpeg regression", () => {
  it.each(exampleGrammars.map((f) => [f] as const))(
    "%s parses as a grammar",
    (file) => {
      const source = readFileSync(join(EXAMPLES_DIR, file), "utf-8");
      const result = parse(grammarDefinition)(source);
      expect(result.success).toBe(true);
    },
  );

  describe.each([
    ["basic", generateTypeScriptParser] as const,
    ["optimized", generateOptimizedTypeScriptParser] as const,
  ])("%s codegen", (label, generate) => {
    // Same reasoning as self-hosting.spec.ts: mkdtempSync inside the
    // package so the generated module's bare `@suzumiyaaoba/tpeg-*`
    // imports resolve through this workspace's node_modules, and a
    // per-run directory so concurrent `vp test` runs can't collide.
    let generatedDir: string;

    beforeAll(() => {
      generatedDir = mkdtempSync(join(__dirname, "..", `.generated-examples-`));
    });

    afterAll(() => {
      rmSync(generatedDir, { recursive: true, force: true });
    });

    it.each(exampleGrammars.map((f) => [f] as const))(
      "%s generates loadable code",
      async (file) => {
        const source = readFileSync(join(EXAMPLES_DIR, file), "utf-8");
        const parsed = parse(grammarDefinition)(source);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        const generated = generate(parsed.val);
        const outPath = join(generatedDir, `${label}-${file}.ts`);
        writeFileSync(outPath, generated.code);
        await expect(import(pathToFileURL(outPath).href)).resolves.toBeTruthy();
      },
    );

    describe.each(SAMPLE_PAIRS.map((p) => [p] as const))("%s vs %s", (pair) => {
      let parser: Parser<unknown>;
      let source: string;

      beforeAll(async () => {
        source = readFileSync(join(EXAMPLES_DIR, pair.grammar), "utf-8");
        const parsed = parse(grammarDefinition)(source);
        if (!parsed.success) {
          throw new Error(`failed to parse ${pair.grammar}`);
        }
        const outPath = join(generatedDir, `${label}-${pair.grammar}-run.ts`);
        writeFileSync(outPath, generate(parsed.val).code);
        const mod = (await import(pathToFileURL(outPath).href)) as Record<
          string,
          Parser<unknown>
        >;
        const entry = mod[pair.entry];
        if (!entry) {
          throw new Error(
            `${pair.grammar}: generated module has no export '${pair.entry}'`,
          );
        }
        parser = entry;
      });

      const fullyConsumes = (input: string): boolean => {
        const result = parse(parser)(input);
        return result.success && result.next === input.length;
      };

      it("fully consumes every per-line sample", () => {
        for (const input of lineSamples(pair.samples)) {
          const mustFail =
            pair.grammar === "calculator.tpeg" &&
            CALCULATOR_ERROR_CASES.has(input);
          expect(fullyConsumes(input), `${JSON.stringify(input)}`).toBe(
            !mustFail,
          );
        }
      });

      const docs = documentSamples(pair.samples);
      if (docs.length > 0) {
        it("fully consumes the whole-document sample(s)", () => {
          for (const doc of docs) {
            expect(fullyConsumes(doc)).toBe(true);
          }
        });
      }
    });
  });
});

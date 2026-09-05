import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
/**
 * Self-hosting verification: TPEG's own grammar syntax, described as a
 * `.tpeg` file (`examples/tpeg-self.tpeg`), is parsed by the hand-written
 * grammar parser, run through both code generators, and the *generated*
 * parser is then checked against tpeg-self.tpeg itself and every other
 * `examples/*.tpeg` file.
 *
 * Two things this deliberately does NOT cover:
 * - AST equality between the hand-written and generated parsers (a full
 *   bootstrap) - that would additionally require a `transforms` block
 *   turning captures back into the same AST shape. "Self-parsing" here
 *   means: the generated parser module loads without error, accepts the
 *   grammar file it was generated from and other independently-written
 *   `.tpeg` files (fully consuming them), and rejects malformed input.
 * - Multi-line rule bodies. tpeg-self.tpeg's `inline_ws` (same-line only)
 *   vs. `gap` (may span lines) split means a rule's expression ends at the
 *   first line break - real TPEG grammars (e.g. docs/peg-grammar.md's
 *   multi-line labeled-choice examples) can span multiple lines, which
 *   this self-description doesn't model. Every example under `examples/`
 *   happens to write one rule per line, so this doesn't limit what's
 *   verified below, but it is a real gap versus the full language.
 */
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParseResult, Parser } from "@suzumiyaaoba/tpeg-core";
import { parse } from "@suzumiyaaoba/tpeg-core";
import {
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  grammarDefinition,
} from "@suzumiyaaoba/tpeg-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, "..", "examples");
const EXAMPLE_PATH = join(EXAMPLES_DIR, "tpeg-self.tpeg");
const source = readFileSync(EXAMPLE_PATH, "utf-8");
const otherExampleFiles = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".tpeg") && f !== "tpeg-self.tpeg")
  .sort();

/** Shape of a module generated from tpeg-self.tpeg - only `grammar_def` is used here. */
interface GeneratedSelfModule {
  grammar_def: Parser<unknown>;
}

const isFullyConsumed = (
  result: ParseResult<unknown>,
  input: string,
): boolean => result.success && input.slice(result.next).trim().length === 0;

describe("self-hosting: tpeg-self.tpeg", () => {
  it("is parsed by the hand-written grammar parser", () => {
    const result = parse(grammarDefinition)(source);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(isFullyConsumed(result, source)).toBe(true);
      expect(result.val.rules.map((r) => r.name)).toContain("grammar_def");
    }
  });

  describe.each([
    ["basic", generateTypeScriptParser] as const,
    ["optimized", generateOptimizedTypeScriptParser] as const,
  ])("%s codegen", (label, generate) => {
    // A per-process, per-run directory (not a fixed path under the
    // package) -- this spec previously wrote to a shared, fixed
    // `.generated/<label>.generated.ts` path and blanket-`rmSync`'d it in
    // an outer `afterAll`, which raced (confirmed empirically: running
    // several `vp test run` processes concurrently produces "Cannot find
    // module '.../optimized.generated.ts'" here, from one process's
    // cleanup or overwrite hitting another's still-loading import) with
    // any other concurrent run of this same file, including another
    // process's `vp test run`. `mkdtempSync` gives each run's `beforeAll`
    // a directory nothing else can collide with.
    //
    // Must stay INSIDE the package (not the OS tmpdir) -- the generated
    // code imports bare specifiers (`@suzumiyaaoba/tpeg-core` etc.),
    // which Node's module resolution only finds by walking up from the
    // importing file's own location to a reachable `node_modules`; a
    // directory outside this workspace has none (confirmed empirically:
    // using `os.tmpdir()` here fails every import with "Cannot find
    // package '@suzumiyaaoba/tpeg-core'"). Prefixed with `.` for the
    // same reason the old fixed `.generated` dir was: outside
    // tsconfig.json's "src/**/*" include, so a leftover directory from a
    // crashed run can't be picked up by a later build/typecheck.
    let generatedDir: string;
    let generatedPath: string;
    let mod: GeneratedSelfModule;

    beforeAll(async () => {
      const parsed = parse(grammarDefinition)(source);
      if (!parsed.success) {
        throw new Error("hand-written parser failed to parse tpeg-self.tpeg");
      }
      const generated = generate(parsed.val);
      generatedDir = mkdtempSync(join(__dirname, "..", `.generated-${label}-`));
      generatedPath = join(generatedDir, `${label}.generated.ts`);
      writeFileSync(generatedPath, generated.code);
      mod = (await import(generatedPath)) as GeneratedSelfModule;
    });

    afterAll(() => {
      rmSync(generatedDir, { recursive: true, force: true });
    });

    it("loads without a temporal-dead-zone error and parses its own source", () => {
      const result = parse(mod.grammar_def)(source);
      expect(result.success).toBe(true);
      expect(isFullyConsumed(result, source)).toBe(true);
    });

    it("tolerates leading blank lines before the grammar keyword", () => {
      const withLeadingBlanks = `\n\n${source}`;
      const result = parse(mod.grammar_def)(withLeadingBlanks);
      expect(result.success).toBe(true);
      expect(isFullyConsumed(result, withLeadingBlanks)).toBe(true);
    });

    it("rejects a grammar file missing its closing brace", () => {
      const malformed = source.replace(/\}\s*$/, "");
      const result = parse(mod.grammar_def)(malformed);
      expect(isFullyConsumed(result, malformed)).toBe(false);
    });

    it("rejects an unterminated string literal", () => {
      const malformed = source.replace('"grammar"', '"grammar');
      const result = parse(mod.grammar_def)(malformed);
      expect(isFullyConsumed(result, malformed)).toBe(false);
    });

    it("rejects non-grammar input", () => {
      const result = parse(mod.grammar_def)("not a grammar at all");
      expect(isFullyConsumed(result, "not a grammar at all")).toBe(false);
    });

    it.each(otherExampleFiles.map((f) => [f] as const))(
      "parses the independently-written %s",
      (file) => {
        const text = readFileSync(join(EXAMPLES_DIR, file), "utf-8");
        const result = parse(mod.grammar_def)(text);
        expect(result.success).toBe(true);
        expect(isFullyConsumed(result, text)).toBe(true);
      },
    );
  });
});

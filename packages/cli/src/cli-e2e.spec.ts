/**
 * End-to-end verification of the `tpeg` CLI's actual output: `.tpeg` source
 * -> generated `.ts` file -> `tsc --noEmit` type-checks it -> the generated
 * module is imported and executed against real input.
 *
 * `cli.spec.ts` already covers the CLI's own argument handling (exit codes,
 * stdout/stderr messages, `-o`/`--name-prefix`/`--no-types`/etc.) by
 * inspecting the generated code as a STRING (`expect(stdout).toContain(...)`)
 * -- it never actually compiles or runs what the CLI writes to disk. That
 * gap is exactly how `@suzumiyaaoba/tpeg-generator`'s Eta-based generator
 * shipped four separate defects undetected (see
 * `packages/generator/src/eta-differential.spec.ts`'s module doc comment):
 * a forward/self-referencing rule reference that throws a temporal-dead-
 * zone `ReferenceError` the moment the generated module is evaluated, and a
 * control character in a string/char-class literal emitted as a raw byte,
 * producing invalid TypeScript source -- neither is visible to a test that
 * only greps the generated string for expected substrings. The `tpeg` CLI
 * itself generates via `tpeg-parser`'s `generateTypeScriptParser`/
 * `generateOptimizedTypeScriptParser` (not the Eta generator, which no
 * other package in this repo depends on -- see CLAUDE.md's dependency
 * graph), and the wider differential-fuzzing suites
 * (`codegen-differential.spec.ts`) found no equivalent defect there -- but
 * this file exists so an actual load-and-run failure on the CLI's own
 * output would be caught here directly, at the one boundary a real
 * consumer of the `tpeg` binary actually crosses (a file on disk,
 * `tsc`-compiled, imported, executed), rather than relying on that
 * inference alone.
 *
 * The test grammar below deliberately combines a self-recursive rule (the
 * shape that broke the Eta generator's `generateIdentifier`) with a
 * control-character string literal (the shape that broke its
 * `escapeStringLiteral`) in one file, so a regression of either kind
 * through the CLI's actual code path would fail here.
 */

import { describe, expect, test } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./cli";

// packages/cli/src -> packages/cli -> packages -> repo root. Resolved from
// this file's own location (not `process.cwd()`), so it doesn't matter
// whether this test is invoked via the root `bun run test` or from inside
// `packages/cli` directly.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const TSC_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsc");

/** A grammar combining a self-recursive rule (`paren`) with a
 * control-character string literal (`nl`'s `"\n"`) and a labeled
 * `ActionExpression`, in one file -- see this module's doc comment for why
 * these three specific shapes are combined here rather than tested in
 * isolation. */
const TEST_GRAMMAR = `
grammar Nested {
  start = paren / nl / digits
  paren = "(" start ")"
  nl = "\\n"
  digits = value:[0-9]+ { return Number.parseInt(value.join(""), 10); }
}
`;

/** Compiles `outputPath` (a real file on disk, exactly as \`tpeg\` writes
 * it) with the repo's own \`tsc\`, in an ephemeral project rooted INSIDE
 * the repo tree -- so TypeScript's module resolution walks up to the
 * real repo-root \`node_modules\` (where every \`@suzumiyaaoba/tpeg-*\`
 * workspace package is symlinked) exactly like a real consumer's project
 * would, without needing its own copy of any dependency. Throws (via
 * \`execFileSync\`) if \`tsc\` reports any error. */
const typeCheck = (dir: string, outputPath: string): void => {
  const tsconfigPath = join(dir, "tsconfig.json");
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      include: [outputPath],
    }),
    "utf8",
  );
  execFileSync(TSC_BIN, ["--project", tsconfigPath], {
    cwd: dir,
    stdio: "pipe",
  });
};

/**
 * Builds a `.tpeg` source large enough that its generated output exceeds a
 * single OS pipe buffer (64KiB on macOS/Linux), so a truncation bug that
 * only shows up once `process.stdout.write` has to be flushed across
 * multiple writes/ticks is actually exercised.
 */
const bigGrammarSource = (ruleCount: number): string => {
  const rules = Array.from(
    { length: ruleCount },
    (_, i) => `  rule_${i} = "token_${i}"`,
  ).join("\n");
  return `grammar Big {\n${rules}\n}\n`;
};

describe("tpeg CLI end-to-end (generate -> type-check -> execute)", () => {
  // Created INSIDE the repo tree (not `os.tmpdir()`, unlike `cli.spec.ts`'s
  // own `dir` fixture) so `typeCheck`'s module resolution can find the
  // real workspace `node_modules`.
  const makeWorkDir = () =>
    mkdtempSync(join(REPO_ROOT, "packages", "cli", ".tmp-e2e-"));

  test("default generator: generated file type-checks and runs correctly on a recursive + control-character grammar", async () => {
    const dir = makeWorkDir();
    try {
      const inputPath = join(dir, "grammar.tpeg");
      const outputPath = join(dir, "parser.ts");
      writeFileSync(inputPath, TEST_GRAMMAR, "utf8");

      const exitCode = run([inputPath, "-o", outputPath]);
      expect(exitCode).toBe(0);

      typeCheck(dir, outputPath);

      const mod = (await import(outputPath)) as {
        start: (input: string, pos: number) => unknown;
      };
      expect(mod.start("((\n))", 0)).toMatchObject({
        success: true,
        next: 5,
      });
      expect(mod.start("42", 0)).toMatchObject({
        success: true,
        val: 42,
        next: 2,
      });
      expect(mod.start("x", 0)).toMatchObject({ success: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--optimize generator: generated file type-checks and runs correctly on the same grammar", async () => {
    const dir = makeWorkDir();
    try {
      const inputPath = join(dir, "grammar.tpeg");
      const outputPath = join(dir, "parser.ts");
      writeFileSync(inputPath, TEST_GRAMMAR, "utf8");

      const exitCode = run([inputPath, "-o", outputPath, "--optimize"]);
      expect(exitCode).toBe(0);

      typeCheck(dir, outputPath);

      const mod = (await import(outputPath)) as {
        start: (input: string, pos: number) => unknown;
      };
      expect(mod.start("(((\n)))", 0)).toMatchObject({
        success: true,
        next: 7,
      });
      expect(mod.start("7", 0)).toMatchObject({
        success: true,
        val: 7,
        next: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stdout is not truncated when piped to another process, even for output larger than one OS pipe buffer", () => {
    // Regression test for a real bug: `process.stdout.write()` to a piped
    // (non-TTY, non-regular-file) stdout is asynchronous, and the CLI used
    // to call the synchronous `process.exit(...)` immediately afterwards --
    // terminating the process before pending writes reached the OS pipe.
    // `-o <file>` and shell `>` redirection both go through a different,
    // synchronous fs path and never showed the bug, which is why it went
    // unnoticed: only a genuine pipe to a second process exercises it. This
    // spawns the real CLI as its own OS process (an in-process `run()` call,
    // as the rest of this file uses, would not reproduce the race at all)
    // and reads its stdout the same way a shell pipeline would.
    const dir = makeWorkDir();
    try {
      const inputPath = join(dir, "big.tpeg");
      // 4000 rules -> a few hundred KB of generated code, several multiples
      // of a 64KiB pipe buffer.
      writeFileSync(inputPath, bigGrammarSource(4000), "utf8");

      const cliEntry = join(REPO_ROOT, "packages", "cli", "src", "cli.ts");
      const stdout = execFileSync("bun", ["run", cliEntry, inputPath], {
        cwd: dir,
        stdio: ["ignore", "pipe", "ignore"],
      });

      const outputPath = join(dir, "parser.ts");
      const exitCode = run([inputPath, "-o", outputPath]);
      expect(exitCode).toBe(0);
      const written = readFileSync(outputPath, "utf8");
      // `-o` writes the generated code as-is; stdout additionally appends a
      // trailing newline when the generated code doesn't already end with
      // one (see `cli.ts`) -- so the piped output is the file's content
      // plus exactly that one byte.
      const expected = written.endsWith("\n") ? written : `${written}\n`;

      expect(stdout.length).toBe(Buffer.byteLength(expected, "utf8"));
      expect(stdout.toString("utf8")).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

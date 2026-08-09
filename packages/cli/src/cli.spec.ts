import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli";

const SIMPLE_GRAMMAR = `
grammar Calculator {
  number = [0-9]+
}
`;

const GRAMMAR_WITH_TRANSFORM = `
grammar Calculator {
  number = digits:[0-9]+
}

transforms Evaluator@typescript {
  number(captures: { digits: string[] }) -> Result<number> {
    return { success: true, value: parseInt(captures.digits.join(""), 10) };
  }
}
`;

function captureOutput(fn: () => number): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string) => {
    stdoutChunks.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    stderrChunks.push(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    const exitCode = fn();
    return {
      exitCode,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

describe("tpeg CLI", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tpeg-cli-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints usage and exits 0 for --help", () => {
    const { exitCode, stdout } = captureOutput(() => run(["--help"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: tpeg <input.tpeg> [options]");
  });

  it("prints the package version for --version", () => {
    const { exitCode, stdout } = captureOutput(() => run(["--version"]));
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("fails with a usage message when no input file is given", () => {
    const { exitCode, stderr } = captureOutput(() => run([]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing required <input.tpeg> argument");
  });

  it("fails with a clear message when the input file doesn't exist", () => {
    const { exitCode, stderr } = captureOutput(() =>
      run([join(dir, "does-not-exist.tpeg")]),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("could not read");
  });

  it("fails with position info when the grammar fails to parse", () => {
    const inputPath = join(dir, "broken.tpeg");
    writeFileSync(inputPath, "not a valid grammar file at all {{{", "utf8");

    const { exitCode, stderr } = captureOutput(() => run([inputPath]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("failed to parse");
    expect(stderr).toMatch(/line \d+, column \d+/);
  });

  it("writes generated code to stdout by default", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { exitCode, stdout } = captureOutput(() => run([inputPath]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("export const number");
    // `[0-9]+` (a Plus over a bare CharacterClass) now collapses to a
    // single `charClassRun(...)` scan instead of `oneOrMore(charClass(...))`
    // -- see `packages/core/src/char-class.ts`'s `charClassRun` doc
    // comment.
    expect(stdout).toContain("charClassRun");
  });

  it("writes generated code to a file with -o", () => {
    const inputPath = join(dir, "grammar.tpeg");
    const outputPath = join(dir, "parser.ts");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { exitCode, stderr } = captureOutput(() =>
      run([inputPath, "-o", outputPath]),
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("wrote 1 parser(s)");

    const written = readFileSync(outputPath, "utf8");
    expect(written).toContain("export const number");
  });

  it("applies --name-prefix to generated exports", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { stdout } = captureOutput(() =>
      run([inputPath, "--name-prefix", "calc_"]),
    );
    expect(stdout).toContain("export const calc_number");
  });

  it("omits type annotations with --no-types", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { stdout } = captureOutput(() => run([inputPath, "--no-types"]));
    expect(stdout).toContain("export const number =");
    expect(stdout).not.toContain("Parser<any>");
  });

  it("uses the optimized generator with --optimize", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { exitCode, stdout } = captureOutput(() =>
      run([inputPath, "--optimize"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("export const number");
  });

  it("rejects --regex-fusion without --optimize", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { exitCode, stderr } = captureOutput(() =>
      run([inputPath, "--regex-fusion"]),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("requires --optimize");
  });

  it("accepts --regex-fusion together with --optimize", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { exitCode, stdout } = captureOutput(() =>
      run([inputPath, "--optimize", "--regex-fusion"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("export const number");
  });

  it("rejects --regex-fusion-subtree without --optimize", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { exitCode, stderr } = captureOutput(() =>
      run([inputPath, "--regex-fusion-subtree"]),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("requires --optimize");
  });

  it("accepts --regex-fusion-subtree alone, without also passing --regex-fusion (it implies it)", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { exitCode, stdout } = captureOutput(() =>
      run([inputPath, "--optimize", "--regex-fusion-subtree"]),
    );
    expect(exitCode).toBe(0);
    // `number = [0-9]+` is a bare Plus over a CharacterClass -- fusable
    // as a whole rule under EITHER scope, but this specifically confirms
    // `--regex-fusion-subtree` alone (no `--regex-fusion`) still reaches
    // codegen's fusion path at all.
    expect(stdout).toContain("regexFusedMap(");
  });

  it("fuses a label/action-guarded sub-expression with --regex-fusion-subtree that --regex-fusion alone cannot reach", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(
      inputPath,
      `
grammar Ident {
  ident = h:[a-zA-Z_] t:[a-zA-Z0-9_]* { return h + t.join(""); }
}
`,
      "utf8",
    );

    const ruleScope = captureOutput(() =>
      run([inputPath, "--optimize", "--regex-fusion"]),
    );
    expect(ruleScope.exitCode).toBe(0);
    // The whole `ident` rule has an ActionExpression, disqualifying it
    // from whole-rule fusion entirely.
    expect(ruleScope.stdout).not.toContain("regexFusedMap(");

    const subtreeScope = captureOutput(() =>
      run([inputPath, "--optimize", "--regex-fusion-subtree"]),
    );
    expect(subtreeScope.exitCode).toBe(0);
    // Sub-expression fusion reaches `t:[a-zA-Z0-9_]*`'s Star, behind the
    // label AND the action.
    expect(subtreeScope.stdout).toContain("regexFusedMap(");
  });

  it("applies automatic cut insertion with --auto-cut", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(
      inputPath,
      `
grammar Cuttable {
  entry = "[" name "]" / name
  name  = [a-zA-Z]+
}
`,
      "utf8",
    );

    const { exitCode, stdout } = captureOutput(() =>
      run([inputPath, "--auto-cut"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("commit(");
  });

  it("promotes a provably-safe cut to commitAtTopLevel with --auto-cut --promote-cuts", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(
      inputPath,
      `
grammar Cuttable {
  entry = "[" name "]" / name
  name  = [a-zA-Z]+
}
`,
      "utf8",
    );

    // Without --promote-cuts: the cut sits inside entry's own Choice, not
    // a direct element of a top-level Sequence, so it stays plain commit
    // (this is the exact case the "applies automatic cut insertion" test
    // above already pins). With --promote-cuts, entry IS the start rule
    // (no reference site to check) and its two alternatives have disjoint
    // FIRST sets ({[} vs [a-zA-Z]), so the cut should promote.
    const { exitCode, stdout } = captureOutput(() =>
      run([inputPath, "--auto-cut", "--promote-cuts"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("commitAtTopLevel(");
    expect(stdout).not.toContain(" commit(");
  });

  it("--promote-cuts without --auto-cut or a hand-written `~` is a no-op", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { exitCode, stdout } = captureOutput(() =>
      run([inputPath, "--promote-cuts"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("commit");
  });

  it("generates a parser that applies a transform function, and it runs correctly", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const inputPath = join(dir, "grammar.tpeg");
    const outputPath = join(dir, "parser.ts");
    writeFileSync(inputPath, GRAMMAR_WITH_TRANSFORM, "utf8");

    const { exitCode } = captureOutput(() =>
      run([inputPath, "-o", outputPath]),
    );
    expect(exitCode).toBe(0);

    const code = readFileSync(outputPath, "utf8");
    const body = code
      .replace(/^import[^\n]*\n?/gm, "")
      .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { number };`,
    );
    const { number } = moduleFactory(...Object.values(core));

    const pos = 0;
    expect(number("42", pos)).toMatchObject({ success: true, val: 42 });
  });

  it("rejects a left-recursive grammar with a clean error, writing no output", () => {
    // `expr` references itself before consuming any input (the first
    // alternative's leftmost element is `expr` itself) -- classic left
    // recursion, which loops forever (a stack-overflow `RangeError`) when
    // a compiled parser actually runs. `packages/parser/src/
    // grammar-validation.ts`'s `validateGrammar` rejects this at
    // GENERATION time now, so the CLI must surface that as a clean,
    // non-zero-exit error rather than crashing on an uncaught exception
    // or writing a parser that would blow the stack the first time it's
    // used.
    const inputPath = join(dir, "left-recursive.tpeg");
    const outputPath = join(dir, "parser.ts");
    writeFileSync(
      inputPath,
      `
grammar Arith {
  expr = expr "+" term / term
  term = [0-9]+
}
`,
      "utf8",
    );

    const { exitCode, stdout, stderr } = captureOutput(() =>
      run([inputPath, "-o", outputPath]),
    );
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("error:");
    expect(stderr).toMatch(/left-recursive/i);
    expect(stderr).toContain("rule(s): expr");
    expect(existsSync(outputPath)).toBe(false);
  });

  it("does not reject an ordinary (right-recursive) grammar", () => {
    const inputPath = join(dir, "grammar.tpeg");
    writeFileSync(inputPath, SIMPLE_GRAMMAR, "utf8");

    const { exitCode, stderr } = captureOutput(() => run([inputPath]));
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("left recursion");
  });

  it("rejects a left-recursive grammar on the --optimize path too", () => {
    const inputPath = join(dir, "left-recursive.tpeg");
    writeFileSync(
      inputPath,
      `
grammar Arith {
  expr = expr "+" term / term
  term = [0-9]+
}
`,
      "utf8",
    );

    const { exitCode, stderr } = captureOutput(() =>
      run([inputPath, "--optimize"]),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/left-recursive/i);
  });

  it("rejects a grammar with a duplicate rule name instead of hanging", () => {
    // `first-sets.ts`'s FIRST-set fixpoint is keyed by rule name -- two
    // rules sharing a name used to make it oscillate forever instead of
    // converging (see `grammar-validation.ts`'s doc comment). This pins
    // that the CLI now reports it as a clean error instead of hanging.
    const inputPath = join(dir, "duplicate-rule.tpeg");
    const outputPath = join(dir, "parser.ts");
    writeFileSync(
      inputPath,
      `
grammar G {
  start = "a"
  start = "b"
}
`,
      "utf8",
    );

    const { exitCode, stdout, stderr } = captureOutput(() =>
      run([inputPath, "-o", outputPath]),
    );
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("error:");
    expect(stderr).toMatch(/duplicate rule/i);
    expect(stderr).toContain("start");
    expect(existsSync(outputPath)).toBe(false);
  });

  it("rejects a rule left-recursive only behind a nullable prefix", () => {
    // Hidden left recursion: the leading `"a"?` can match zero
    // characters, so `e` can reach itself without consuming anything --
    // invisible to a check that only looks at a sequence's literal first
    // element (see `grammar-validation.ts`'s doc comment).
    const inputPath = join(dir, "hidden-left-recursive.tpeg");
    writeFileSync(
      inputPath,
      `
grammar G {
  start = e
  e = "a"? e "b" / "c"
}
`,
      "utf8",
    );

    const { exitCode, stderr } = captureOutput(() => run([inputPath]));
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/left-recursive/i);
    expect(stderr).toContain("rule(s): e");
  });
});

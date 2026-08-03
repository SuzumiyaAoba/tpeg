import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(stdout).toContain("oneOrMore");
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
    expect(stderr).toContain("--regex-fusion requires --optimize");
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
});

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { generateTypeScriptParser } from "./codegen";
import { compileStart } from "./differential-fuzz";
import { bundleGrammarFile } from "./module-bundler";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "tpeg-bundle-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function write(name: string, source: string): string {
  const path = join(directory, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  return path;
}

function compile(path: string) {
  const grammar = bundleGrammarFile(path);
  const generated = generateTypeScriptParser(
    {
      ...grammar,
      annotations: grammar.annotations.filter(
        (annotation) => annotation.key !== "start",
      ),
    },
    {
      includeImports: false,
      includeTypes: false,
      namePrefix: "linked_",
    },
  );
  return Object.fromEntries(
    grammar.rules.map((rule) => [
      rule.name,
      compileStart(
        `${generated.code}\nexport { linked_${rule.name} as start };`,
        core,
        combinator,
      ),
    ]),
  );
}

test("links transitive imports, aliases, private helpers, transforms and module-local skip rules", () => {
  write(
    "lex/digits.tpeg",
    'grammar Digits { @version: "1.2.3"\n @export: [number]\n number = @(digits)\n digits = [0-9]+ }\ntransforms T@typescript { number(captures: string) -> Result<number> { return { success: true, value: parseInt(captures, 10) }; } }',
  );
  write(
    "wrapped.tpeg",
    'import "lex/digits.tpeg" { number }\ngrammar Wrapped { @requires: { "lex/digits.tpeg": "^1.0" }\n @skip: ws\n start = value:number\n ws = [ ]* }',
  );
  const entry = write(
    "main.tpeg",
    'import "wrapped.tpeg" as w\nimport "lex/digits.tpeg" as d\ngrammar Main { start = first:w.start ":" second:d.number }',
  );
  const parsers = compile(entry);
  expect(core.parse(parsers["start"]!)(" 12 :34")).toMatchObject({
    success: true,
    next: 7,
    val: { first: { value: 12 }, second: 34 },
  });
});

test("imports modules with identical basenames without merging their rules", () => {
  write("a/shared.tpeg", 'grammar Shared { token = "a" }');
  write("b/shared.tpeg", 'grammar Shared { token = "b" }');
  const entry = write(
    "main.tpeg",
    'import "a/shared.tpeg" as a\nimport "b/shared.tpeg" as b\ngrammar Main { start = a.token b.token }',
  );
  expect(core.parse(compile(entry)["start"]!)("ab")).toMatchObject({
    success: true,
    val: ["a", "b"],
    next: 2,
  });
});

test("canonical paths retain a symlink import's implicit alias and version requirement", () => {
  const original = write(
    "original.tpeg",
    'grammar Original { @version: "1.2.3"\n public = "x" }',
  );
  symlinkSync(original, join(directory, "alias.tpeg"));
  const entry = write(
    "main.tpeg",
    'import "alias.tpeg"\ngrammar Main { @requires: { "alias.tpeg": "^1.0" }\n start = alias.public }',
  );
  expect(core.parse(compile(entry)["start"]!)("x")).toMatchObject({
    success: true,
    val: "x",
  });
});

test("inherited rules call child overrides while explicit parent references call the parent", () => {
  write(
    "base.tpeg",
    'grammar Base { @start: start\n helper = "h"\n start = value:token\n token = "a" }',
  );
  const entry = write(
    "main.tpeg",
    'import "base.tpeg" as b\ngrammar Main extends b.Base { @start: start\n token = "b"\n original = b.start }',
  );
  const parsers = compile(entry);
  expect(core.parse(parsers["start"]!)("b")).toMatchObject({
    success: true,
    val: { value: "b" },
  });
  expect(core.parse(parsers["original"]!)("a")).toMatchObject({
    success: true,
    val: { value: "a" },
  });
  const inherited = write(
    "inherited.tpeg",
    'import "base.tpeg" as b\ngrammar Inherited extends b.Base {}',
  );
  expect(bundleGrammarFile(inherited).annotations).toContainEqual({
    type: "GrammarAnnotation",
    key: "start",
    value: "start",
  });
});

test("includes requires an explicit override for ambiguous rule names", () => {
  write("a.tpeg", 'grammar A { token = "a" }');
  write("b.tpeg", 'grammar B { token = "b" }');
  const imports = 'import "a.tpeg" as a\nimport "b.tpeg" as b\n';
  const entry = write(
    "main.tpeg",
    imports + "grammar Main includes a.A, b.B { start = token }",
  );
  expect(() => bundleGrammarFile(entry)).toThrow("ambiguous");
  write(
    "main.tpeg",
    imports + 'grammar Main includes a.A, b.B { start = token\n token = "c" }',
  );
  expect(core.parse(compile(entry)["start"]!)("c")).toMatchObject({
    success: true,
    val: "c",
  });
});

test("inherited transforms survive a child transform set for another rule", () => {
  write(
    "base.tpeg",
    "grammar Base { start = number\n number = [0-9]+ }\ntransforms T@typescript { number(captures: any) -> Result<number> { return { success: true, value: captures.length }; } }",
  );
  const entry = write(
    "main.tpeg",
    'import "base.tpeg" as b\ngrammar Main extends b.Base { @start: start\n extra = "x" }\ntransforms T@typescript { extra(captures: any) -> Result<number> { return { success: true, value: 99 }; } }',
  );
  expect(core.parse(compile(entry)["start"]!)("123")).toMatchObject({
    success: true,
    val: 3,
  });
});

test("transform overrides survive multiple inheritance levels", () => {
  write(
    "base.tpeg",
    "grammar Base { start = number\n number = [0-9]+ }\ntransforms T@typescript { number(captures: any) -> Result<number> { return { success: true, value: captures.length }; } }",
  );
  write(
    "middle.tpeg",
    'import "base.tpeg" as b\ngrammar Middle extends b.Base {}\ntransforms T@typescript { number(captures: any) -> Result<number> { return { success: true, value: 99 }; } }',
  );
  const entry = write(
    "main.tpeg",
    'import "middle.tpeg" as m\ngrammar Main extends m.Middle {}',
  );
  expect(core.parse(compile(entry)["start"]!)("123")).toMatchObject({
    success: true,
    val: 99,
  });
});

test("mixins with different transforms of one inherited rule require an override", () => {
  write("base.tpeg", 'grammar Base { token = "x" }');
  write(
    "left.tpeg",
    'import "base.tpeg" as b\ngrammar Left extends b.Base {}\ntransforms T@typescript { token(captures: any) -> Result<number> { return { success: true, value: 1 }; } }',
  );
  write(
    "right.tpeg",
    'import "base.tpeg" as b\ngrammar Right extends b.Base {}\ntransforms T@typescript { token(captures: any) -> Result<number> { return { success: true, value: 2 }; } }',
  );
  const entry = write(
    "main.tpeg",
    'import "left.tpeg" as l\nimport "right.tpeg" as r\ngrammar Main includes l.Left, r.Right {}',
  );
  expect(() => bundleGrammarFile(entry)).toThrow("ambiguous");
});

test.each([
  'import "base.tpeg" as b\ngrammar Main { start = b.hidden }',
  'import "base.tpeg" { hidden }\ngrammar Main { start = hidden }',
  'import "base.tpeg" { public }\ngrammar Main { start = base.hidden }',
  'import "base.tpeg" version "^2.0" as b\ngrammar Main { start = b.public }',
  'import "base.tpeg" as b\ngrammar Main { @requires: { "base.tpeg": "^2.0" }\n start = b.public }',
  'import "missing.tpeg" as b\ngrammar Main { start = "x" }',
])(
  "rejects unavailable/private/selectively excluded rules and incompatible versions: %s",
  (source) => {
    write(
      "base.tpeg",
      'grammar Base { @version: "1.2.3"\n @export: [public]\n public = hidden\n hidden = "x" }',
    );
    const entry = write("main.tpeg", source);
    expect(() => bundleGrammarFile(entry)).toThrow();
  },
);

test("rejects circular imports and trailing garbage with the source location", () => {
  const entry = write(
    "main.tpeg",
    'import "other.tpeg" as o\ngrammar Main { start = "x" }',
  );
  write("other.tpeg", 'import "main.tpeg" as m\ngrammar Other { start = "y" }');
  expect(() => bundleGrammarFile(entry)).toThrow("Circular dependency");
  write("main.tpeg", '\ufeffgrammar Main { start = "x" } garbage');
  expect(() => bundleGrammarFile(entry)).toThrow(/main.tpeg:1:/);
});

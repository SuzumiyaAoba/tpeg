import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import {
  ALL_TEST_INPUTS,
  applySkipDesugar,
  bundleGrammarFile,
  compileStart,
  genGrammarSource,
  generateTypeScriptParser,
  grammarDefinition,
  makeRng,
  tpegFile,
} from "@suzumiyaaoba/tpeg-parser";
import { describe, expect, test } from "vite-plus/test";
import {
  generateNativeParser,
  rustStringLiteral as rustString,
  type NativeLanguage,
} from "./native-generator";

const fixtures = [
  {
    source: 'grammar G { start = "a" [0-9]+ "!"? }',
    inputs: ["a12!", "a1", "a", "b", "a1?"],
  },
  {
    source:
      'grammar G { start = first:pair second:(x:"x" / y:"y")? pair\n pair = key:"a" value:"b" }',
    inputs: ["abxab", "abyab", "abab", "abz", ""],
  },
  {
    source: 'grammar G { start = x:"x" (~(a:"a" / b:"b")) }',
    inputs: ["xa", "xb", "x", "xy", ""],
  },
  {
    source: 'grammar G { start = "(" inner:start? ")" / "x" }',
    inputs: ["x", "()", "(x)", "((x))", "(x", ""],
  },
  {
    source: 'grammar G { start = "😀" tail:[^😀]* !. }',
    inputs: ["😀abc", "😀𐐀\n", "😀😀", "a", ""],
  },
  {
    source: 'grammar G { start = \\b "foo" \\b / "a" \\B "b" }',
    inputs: ["foo", "foo!", "food", "ab", "a", ""],
  },
  {
    source:
      'grammar G { @skip: ws\n start = word:token "+" word:token\n @noskip\n token = @[a-z]+\n ws = [ \\t\\n]* }',
    inputs: [" a + b ", "a+b", "a b+c", "a+", ""],
  },
  {
    source: 'grammar G { start = ("a" ~ "b" / "a" "c") / "a" "c" }',
    inputs: ["ab", "ac", "ax", "a", ""],
  },
  {
    source: 'grammar G { start = "s" ("a" ~ "b")* / "s" "a" "x" }',
    inputs: ["sabab", "sax", "sa", "", "x"],
  },
  {
    source: 'grammar G { start = &"a" !("ab") value:@"a"+ }',
    inputs: ["aaa", "a", "ab", "b", ""],
  },
  {
    source: 'grammar G { start = &("a" ~ "b") / "a" "c" }',
    inputs: ["ab", "ac", "ax", ""],
  },
  {
    source: 'grammar G { start = !("a" ~ "b") "a" "c" }',
    inputs: ["ab", "ac", "ax", ""],
  },
  {
    source: 'grammar G { start = ""{2} "x"{1,3} !. }',
    inputs: ["x", "xx", "xxx", "xxxx", ""],
  },
  {
    source: 'grammar G { start = "a"{2,} !. }',
    inputs: ["a", "aa", "aaaa", "aab", ""],
  },
  {
    source:
      'grammar G { start = pair "x" / pair "y"\n @memoize\n pair = value:"a" }',
    inputs: ["ax", "ay", "a", "", "ay!"],
  },
  {
    source: `grammar G { start = value:number\n number = [0-9]+ }
transforms T@typescript { number(captures: any) -> Result<number> { return { success: true, value: captures.length }; } }
transforms T@python { number(captures: any) -> Result<number> {
    return {"success": True, "value": len(captures)}
} }
transforms T@go { number(captures: any) -> Result<number> { return TransformResult{Success: true, Value: len(captures.([]any))} } }
transforms T@rust { number(captures: any) -> Result<number> { match captures { Value::Array(values) => Ok(Value::Number(values.len() as f64)), _ => Err("bad capture".into()) } } }`,
    inputs: ["1", "12345", "", "x"],
  },
];

const commands: Record<NativeLanguage, string> = {
  python: process.env["TPEG_PYTHON"] ?? "python3",
  go: process.env["TPEG_GO"] ?? "go",
  rust: process.env["TPEG_RUSTC"] ?? "rustc",
};

function command(
  program: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const result = spawnSync(program, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${program} ${args.join(" ")}: ${result.error?.message ?? result.stderr}`,
    );
  return result.stdout;
}

function execute(
  language: NativeLanguage,
  code: string,
  inputs: string[],
  directory: string,
): core.ParseResult<unknown>[] {
  let stdout: string;
  if (language === "python") {
    writeFileSync(join(directory, "parser.py"), code);
    stdout = command(
      commands.python,
      [
        "-c",
        `import json, parser\nfor text in json.loads(${JSON.stringify(JSON.stringify(inputs))}):\n    print(json.dumps(parser.parse(text)))`,
      ],
      directory,
    );
  } else if (language === "go") {
    const source = `${code}\nfunc main() { for _, input := range []string{${inputs.map((input) => JSON.stringify(input)).join(",")}} { data, err := json.Marshal(Parse(input)); if err != nil { panic(err) }; fmt.Println(string(data)) } }\n`;
    writeFileSync(join(directory, "parser.go"), source);
    stdout = command(commands.go, ["run", "parser.go"], directory, {
      ...process.env,
      GOCACHE:
        process.env["TPEG_GO_CACHE"] ?? join(tmpdir(), "tpeg-go-build-cache"),
      GOPATH: join(directory, "go-path"),
      GOENV: "off",
      GOTOOLCHAIN: "local",
      GOWORK: "off",
      CGO_ENABLED: "0",
    });
  } else {
    writeFileSync(
      join(directory, "parser.rs"),
      `${code}\nfn main() { for input in [${inputs.map(rustString).join(",")}] { println!("{}", parse(input).to_json()); } }\n`,
    );
    command(
      commands.rust,
      ["--edition=2021", "parser.rs", "-o", "parser"],
      directory,
    );
    stdout = command(join(directory, "parser"), [], directory);
  }
  return stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as core.ParseResult<unknown>);
}

function executeProgram(
  language: NativeLanguage,
  code: string,
  runner: string,
  directory: string,
): core.ParseResult<unknown>[] {
  let output: string;
  if (language === "python") {
    writeFileSync(join(directory, "parser.py"), code);
    output = command(commands.python, ["-c", runner], directory);
  } else if (language === "go") {
    writeFileSync(join(directory, "parser.go"), code + runner);
    output = command(commands.go, ["run", "parser.go"], directory, {
      ...process.env,
      GOCACHE:
        process.env["TPEG_GO_CACHE"] ?? join(tmpdir(), "tpeg-go-build-cache"),
      GOPATH: join(directory, "go-path"),
      GOENV: "off",
      GOTOOLCHAIN: "local",
      GOWORK: "off",
      CGO_ENABLED: "0",
    });
  } else {
    writeFileSync(join(directory, "parser.rs"), code + runner);
    command(
      commands.rust,
      ["--edition=2021", "parser.rs", "-o", "parser"],
      directory,
    );
    output = command(join(directory, "parser"), [], directory);
  }
  return output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as core.ParseResult<unknown>);
}

function comparable(result: core.ParseResult<unknown>) {
  return result.success
    ? {
        success: true as const,
        next: result.next,
        val: JSON.parse(JSON.stringify(result.val ?? null)) as unknown,
      }
    : {
        success: false as const,
        pos: result.error.pos,
        fatal: result.error.fatal ?? false,
        abort: result.error.abort ?? false,
      };
}

function compileOracle(grammar: core.GrammarDefinition): core.Parser<unknown> {
  const code = generateTypeScriptParser(grammar, {
    includeImports: false,
    includeTypes: false,
  }).code;
  const locals = new Set([...grammar.rules.map((rule) => rule.name), "start"]);
  // The legacy test evaluator injects every helper, unlike real generated
  // imports. Do not let an unused helper such as token shadow a local rule.
  const bindings = Object.fromEntries(
    Object.entries({ ...combinator, ...core }).filter(
      ([name]) => !locals.has(name),
    ),
  );
  return compileStart(code, bindings, {});
}

describe("native parsers execute the same grammars as TypeScript", () => {
  for (const language of ["python", "go", "rust"] as const) {
    const available =
      spawnSync(commands[language], ["--version"], { encoding: "utf8" })
        .error === undefined;
    test.skipIf(!available && process.env["TPEG_NATIVE_REQUIRED"] !== "1")(
      `${language}: compile and run every expression, capture, skip, cut, Unicode and transform fixture`,
      () => {
        const directory = mkdtempSync(join(tmpdir(), `tpeg-${language}-`));
        try {
          for (const { source, inputs } of fixtures) {
            const parsed = core.parse(tpegFile)(source);
            expect(parsed.success, source).toBe(true);
            if (!parsed.success) throw new Error(parsed.error.message);
            const grammar = parsed.val;
            const base = compileOracle(grammar);
            const generated = generateNativeParser(
              grammar,
              language,
              language === "go"
                ? { packageName: "main", header: 'import "fmt"' }
                : {},
            );
            const results = execute(
              language,
              generated.code,
              inputs,
              directory,
            );
            expect(results).toHaveLength(inputs.length);
            inputs.forEach((input, index) => {
              expect(
                comparable(results[index]!),
                `${source}\ninput: ${JSON.stringify(input)}`,
              ).toEqual(comparable(core.parse(base)(input)));
            });
          }
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
      180000,
    );

    test.skipIf(!available && process.env["TPEG_NATIVE_REQUIRED"] !== "1")(
      `${language}: options, callbacks, offsets and parse-session isolation`,
      () => {
        const parsed = core.parse(grammarDefinition)(
          'grammar G { @start: word\n other = "other"\n @memoize\n word = chars:[a-z]+\n number = [0-9]+ }',
        );
        if (!parsed.success) throw new Error(parsed.error.message);
        const generated = generateNativeParser(parsed.val, language, {
          namePrefix: "my_",
          ...(language === "go"
            ? { packageName: "main", header: 'import "fmt"' }
            : {}),
        });
        const runners = {
          python: `import json, parser
calls = [parser.my_parse("abc!"), parser.my_parse("xx abc", offset=3), parser.my_parse("12!", rule="number"), parser.my_parse("abc!", complete=True), parser.my_parse("abc", offset=999), parser.my_parse("abc", rule="missing"), parser.my_parse("abc", max_depth=1), parser.my_parse("abc", transforms={"word": lambda value: {"success": True, "value": "first"}}), parser.my_parse("abc", transforms={"word": lambda value: {"success": True, "value": "second"}})]
for result in calls: print(json.dumps(result))`,
          go: `
func main() {
results := []Result{my_Parse("abc!"), my_Parse("xx abc", ParseOptions{Offset: 3}), my_Parse("12!", ParseOptions{Rule: "number"}), my_Parse("abc!", ParseOptions{Complete: true}), my_Parse("abc", ParseOptions{Offset: 999}), my_Parse("abc", ParseOptions{Rule: "missing"}), my_Parse("abc", ParseOptions{MaxDepth: 1}), my_Parse("abc", ParseOptions{Transforms: map[string]Transform{"word": func(value any) TransformResult { return TransformResult{Success: true, Value: "first"} }}}), my_Parse("abc", ParseOptions{Transforms: map[string]Transform{"word": func(value any) TransformResult { return TransformResult{Success: true, Value: "second"} }}})}
for _, result := range results { data, _ := json.Marshal(result); fmt.Println(string(data)) }
}`,
          rust: `
fn first(_: Value) -> Result<Value, String> { Ok(Value::String("first".into())) }
fn second(_: Value) -> Result<Value, String> { Ok(Value::String("second".into())) }
fn main() {
let results = [my_parse("abc!"), my_parse_with_options("xx abc", ParseOptions{offset: 3, ..Default::default()}), my_parse_with_options("12!", ParseOptions{rule: Some("number".into()), ..Default::default()}), my_parse_with_options("abc!", ParseOptions{complete: true, ..Default::default()}), my_parse_with_options("abc", ParseOptions{offset: 999, ..Default::default()}), my_parse_with_options("abc", ParseOptions{rule: Some("missing".into()), ..Default::default()}), my_parse_with_options("abc", ParseOptions{max_depth: 1, ..Default::default()}), my_parse_with_options("abc", ParseOptions{transforms: BTreeMap::from([("word".into(), first as Transform)]), ..Default::default()}), my_parse_with_options("abc", ParseOptions{transforms: BTreeMap::from([("word".into(), second as Transform)]), ..Default::default()})];
for result in results { println!("{}", result.to_json()); }
}`,
        };
        const directory = mkdtempSync(
          join(tmpdir(), `tpeg-options-${language}-`),
        );
        try {
          const results = executeProgram(
            language,
            generated.code,
            runners[language],
            directory,
          );
          expect(results.slice(0, 3).map(comparable)).toEqual([
            { success: true, next: 3, val: { chars: ["a", "b", "c"] } },
            { success: true, next: 6, val: { chars: ["a", "b", "c"] } },
            { success: true, next: 2, val: ["1", "2"] },
          ]);
          expect(results[3]).toMatchObject({
            success: false,
            error: { pos: 3 },
          });
          for (const result of results.slice(4, 7))
            expect(result).toMatchObject({
              success: false,
              error: { fatal: true, abort: true },
            });
          expect(results.slice(7)).toMatchObject([
            { success: true, val: "first" },
            { success: true, val: "second" },
          ]);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
      120000,
    );

    test.skipIf(!available && process.env["TPEG_NATIVE_REQUIRED"] !== "1")(
      `${language}: executes linked imports and inherited overrides`,
      () => {
        const directory = mkdtempSync(
          join(tmpdir(), `tpeg-linked-${language}-`),
        );
        try {
          writeFileSync(
            join(directory, "dep.tpeg"),
            'grammar Dep { @export: [token]\n token = @"a"+ }',
          );
          const entry = join(directory, "main.tpeg");
          writeFileSync(
            entry,
            'import "dep.tpeg" version "^1.0" as d\ngrammar Main extends d.Dep { @start: start\n token = "b"\n start = first:token second:d.token !. }',
          );
          const grammar = bundleGrammarFile(entry);
          const generated = generateNativeParser(
            grammar,
            language,
            language === "go"
              ? { packageName: "main", header: 'import "fmt"' }
              : {},
          );
          const results = execute(
            language,
            generated.code,
            ["ba", "baa", "aa"],
            directory,
          );
          expect(results).toMatchObject([
            { success: true, val: { first: "b", second: "a" }, next: 2 },
            { success: true, val: { first: "b", second: "aa" }, next: 3 },
            { success: false },
          ]);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
      120000,
    );

    test.skipIf(!available && process.env["TPEG_NATIVE_REQUIRED"] !== "1")(
      `${language}: memo cache bounds and transform invocation order`,
      () => {
        const parsed = core.parse(grammarDefinition)(`grammar G {
  bounded = bItem "x" / bItem bItem "z" / bItem "a" "y"
  @memoize: 1
  bItem = bChild
  bChild = "a"
  unlimited = uItem "x" / uItem uItem "z" / uItem "a" "y"
  @memoize
  uItem = uChild
  uChild = "a"
  disabled = dItem "x" / dItem dItem "z" / dItem "a" "y"
  @memoize: 0
  dItem = dChild
  dChild = "a"
  transformed = tItem "x" / tItem "a" "y"
  @memoize
  tItem = "a"
}`);
        if (!parsed.success) throw new Error(parsed.error.message);
        const generated = generateNativeParser(
          parsed.val,
          language,
          language === "go"
            ? { packageName: "main", header: 'import "fmt"' }
            : {},
        );
        const runners = {
          python: `import json, parser
def run(rule, child):
    count = [0]
    def transform(value):
        count[0] += 1
        return {"success": True, "value": count[0]}
    return parser.parse("aay", rule=rule, transforms={child: transform})
for rule, child in [("bounded", "bChild"), ("unlimited", "uChild"), ("disabled", "dChild"), ("transformed", "tItem")]: print(json.dumps(run(rule, child)))`,
          go: `
func main() {
for _, item := range [][2]string{{"bounded", "bChild"}, {"unlimited", "uChild"}, {"disabled", "dChild"}, {"transformed", "tItem"}} {
count := 0
result := Parse("aay", ParseOptions{Rule: item[0], Transforms: map[string]Transform{item[1]: func(value any) TransformResult { count++; return TransformResult{Success: true, Value: count} }}})
data, _ := json.Marshal(result); fmt.Println(string(data))
}
}`,
          rust: `
static COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
fn count(_: Value) -> Result<Value, String> { Ok(Value::Number((COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1) as f64)) }
fn main() {
for (rule, child) in [("bounded", "bChild"), ("unlimited", "uChild"), ("disabled", "dChild"), ("transformed", "tItem")] {
COUNT.store(0, std::sync::atomic::Ordering::SeqCst);
println!("{}", parse_with_options("aay", ParseOptions{rule: Some(rule.into()), transforms: BTreeMap::from([(child.into(), count as Transform)]), ..Default::default()}).to_json());
}
}`,
        };
        const directory = mkdtempSync(join(tmpdir(), `tpeg-memo-${language}-`));
        try {
          expect(
            executeProgram(
              language,
              generated.code,
              runners[language],
              directory,
            ),
          ).toMatchObject([
            { success: true, val: [3, "a", "y"] },
            { success: true, val: [1, "a", "y"] },
            { success: true, val: [4, "a", "y"] },
            { success: true, val: [2, "a", "y"] },
          ]);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
      120000,
    );

    test.skipIf(!available && process.env["TPEG_NATIVE_REQUIRED"] !== "1")(
      `${language}: differential fuzzing of capture values and control flow`,
      () => {
        const rng = makeRng(20261101);
        const rules: core.RuleDefinition[] = [];
        const grammarSources = new Map<string, string>();
        const cases: {
          input: string;
          rule: string;
          expected: ReturnType<typeof comparable>;
        }[] = [];
        let accepted = 0;
        for (let attempt = 0; accepted < 40 && attempt < 1000; attempt++) {
          const source = genGrammarSource(rng);
          const parsed = core.parse(grammarDefinition)(source);
          if (!parsed.success || parsed.val.transforms?.length) continue;
          const grammar = parsed.val;
          if (
            grammar.rules.some((rule) =>
              core.someExpression(
                rule.pattern,
                (expr) =>
                  expr.type === "ActionExpression" ||
                  expr.type === "QualifiedIdentifier" ||
                  (expr.type === "StringLiteral" &&
                    /[\uD800-\uDFFF]/u.test(expr.value)),
              ),
            )
          )
            continue;
          let base: core.Parser<unknown>;
          try {
            base = compileOracle(grammar);
          } catch {
            continue;
          }
          const prefix = `grammar${accepted}_`;
          grammarSources.set(prefix + "start", source);
          const rename = (expr: core.Expression): core.Expression =>
            expr.type === "Identifier"
              ? { ...expr, name: prefix + expr.name }
              : core.mapChildExpressions(expr, rename);
          rules.push(
            ...applySkipDesugar(grammar).rules.map((rule) => ({
              ...rule,
              name: prefix + rule.name,
              pattern: rename(rule.pattern),
            })),
          );
          for (const input of ALL_TEST_INPUTS.filter(
            (input) => !/[\uD800-\uDFFF]/u.test(input),
          ))
            cases.push({
              input,
              rule: prefix + "start",
              expected: comparable(core.parse(base)(input)),
            });
          accepted++;
        }
        expect(accepted).toBe(40);
        const generated = generateNativeParser(
          {
            type: "GrammarDefinition",
            name: "Differential",
            annotations: [],
            rules,
          },
          language,
          language === "go"
            ? { packageName: "main", header: 'import "fmt"' }
            : {},
        );
        const runners = {
          python: `import json, parser\nfor case in json.loads(${JSON.stringify(JSON.stringify(cases.map(({ input, rule }) => ({ input, rule }))))}):\n    print(json.dumps(parser.parse(case["input"], rule=case["rule"])))`,
          go: `\nfunc main() { for _, item := range []struct{input, rule string}{${cases.map(({ input, rule }) => `{${JSON.stringify(input)}, ${JSON.stringify(rule)}}`).join(",")}} { data, _ := json.Marshal(Parse(item.input, ParseOptions{Rule: item.rule})); fmt.Println(string(data)) } }`,
          rust: `\nfn main() { for (input, rule) in [${cases.map(({ input, rule }) => `(${rustString(input)}, ${rustString(rule)})`).join(",")}] { println!("{}", parse_with_options(input, ParseOptions{rule: Some(rule.into()), ..Default::default()}).to_json()); } }`,
        };
        const directory = mkdtempSync(join(tmpdir(), `tpeg-fuzz-${language}-`));
        try {
          const results = executeProgram(
            language,
            generated.code,
            runners[language],
            directory,
          );
          expect(results).toHaveLength(cases.length);
          results.forEach((result, index) => {
            // Diagnostic wording/positions are backend-specific. Recognition,
            // values and cut/abort control flags must agree with the TS oracle.
            const value = comparable(result);
            const expected = cases[index]!.expected;
            const context = `${grammarSources.get(cases[index]!.rule)}\n${JSON.stringify(cases[index]!.input)}\n${JSON.stringify(value)}\n${JSON.stringify(expected)}`;
            if (!value.success && !expected.success) {
              expect(value.fatal, context).toBe(expected.fatal);
              expect(value.abort, context).toBe(expected.abort);
            } else
              expect(
                value,
                `${cases[index]!.rule}, ${JSON.stringify(cases[index]!.input)}`,
              ).toEqual(expected);
          });
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
      120000,
    );
  }

  test.skipIf(
    spawnSync(commands.python, ["--version"]).error !== undefined &&
      process.env["TPEG_NATIVE_REQUIRED"] !== "1",
  )("Python transform indentation preserves multiline string values", () => {
    const parsed = core.parse(tpegFile)(`grammar G { start = "x" }
transforms T@python { start(captures: any) -> Result<string> {
    if captures == "x":
        value = """first
  second
third"""
        return {"success": True, "value": value}
    return {"success": False, "error": "wrong"}
} }`);
    if (!parsed.success) throw new Error(parsed.error.message);
    const generated = generateNativeParser(parsed.val, "python");
    const directory = mkdtempSync(join(tmpdir(), "tpeg-python-transform-"));
    try {
      expect(execute("python", generated.code, ["x"], directory)).toMatchObject(
        [{ success: true, val: "first\n  second\nthird" }],
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("native generation rejects unresolved modules, TypeScript actions and invalid grammars", () => {
    for (const source of [
      "grammar G { start = external.rule }",
      "grammar G { start = missing }",
      'grammar G { start = "x" { return 1; } }',
      'grammar G { start = start / "x" }',
      'grammar G { start = ""* }',
      "grammar G {}",
    ]) {
      const parsed = core.parse(grammarDefinition)(source);
      expect(parsed.success).toBe(true);
      if (parsed.success)
        expect(() => generateNativeParser(parsed.val, "python")).toThrow();
    }
  });
});

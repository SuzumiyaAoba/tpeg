/**
 * Tests for TPEG Code Generation System
 */

import { describe, expect, test } from "bun:test";
import { TPEGCodeGenerator, generateTypeScriptParser } from "./codegen";
import {
  createAnyChar,
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createNegativeLookahead,
  createOptional,
  createPlus,
  createPositiveLookahead,
  createQualifiedIdentifier,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
  createTransformDefinition,
  createTransformFunction,
  createTransformParameter,
  createTransformReturnType,
  createTransformSet,
} from "./types";

describe("TPEG Code Generation", () => {
  describe("TPEGCodeGenerator", () => {
    test("should generate basic string literal parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("hello", createStringLiteral("hello"))],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'export const hello: Parser<any> = literal("hello");',
      );
      expect(result.exports).toEqual(["hello"]);
    });

    test("should generate character class parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "letter",
            createCharacterClass(
              [
                createCharRange("a"), // single character
                createCharRange("c", "z"), // range
              ],
              false,
            ),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain("charClass(");
      expect(result.exports).toEqual(["letter"]);
    });

    test("should generate negated character class parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "notDigit",
            createCharacterClass([createCharRange("0", "9")], true),
          ),
        ],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('negatedCharClass(["0", "9"])');
      expect(result.imports.join("\n")).toContain("negatedCharClass");
    });

    test("should generate AnyChar parser with the anyChar import", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("anything", createAnyChar())],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain("anyChar()");
      expect(result.imports.join("\n")).toContain("anyChar");
    });

    test("generated character class / AnyChar code should actually parse input", async () => {
      const core = await import("@suzumiyaaoba/tpeg-core");

      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "letter",
            createCharacterClass([createCharRange("a", "z")], false),
          ),
          createRuleDefinition(
            "notDigit",
            createCharacterClass([createCharRange("0", "9")], true),
          ),
          createRuleDefinition("anything", createAnyChar()),
        ],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      // Evaluate the generated source directly against the real
      // @suzumiyaaoba/tpeg-core exports, exactly as the emitted `import`
      // statement expects, so a signature mismatch fails this test.
      const body = result.code
        .replace(/^import[^\n]*\n?/gm, "")
        .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
      const moduleFactory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { letter, notDigit, anything };`,
      );
      const { letter, notDigit, anything } = moduleFactory(
        ...Object.values(core),
      );

      const pos = { offset: 0, column: 0, line: 1 };
      expect(letter("m", pos).success).toBe(true);
      expect(notDigit("m", pos).success).toBe(true);
      expect(notDigit("5", pos).success).toBe(false);
      expect(anything("x", pos).success).toBe(true);
    });

    test("should generate sequence parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "greeting",
            createSequence([
              createStringLiteral("hello"),
              createStringLiteral(" "),
              createStringLiteral("world"),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'sequence(literal("hello"), literal(" "), literal("world"))',
      );
    });

    test("should compile a `~` cut marker into commit(...)-wrapped elements after it", () => {
      // `ifStmt` is deliberately NOT the grammar's start rule (index 0)
      // here -- a top-level cut in the start rule's own pattern now
      // compiles to `commitAtTopLevel` instead (see the dedicated
      // `commitAtTopLevel` tests below), which is a different code path
      // this test isn't about. `stmt` stands in as the start rule so this
      // test stays focused on the ordinary `commit` compilation.
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("stmt", createIdentifier("ifStmt")),
          createRuleDefinition(
            "ifStmt",
            createSequence([
              createStringLiteral("if"),
              { type: "Cut" },
              createStringLiteral("cond"),
              createStringLiteral("then"),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'sequence(literal("if"), commit(literal("cond")), commit(literal("then")))',
      );
      expect(result.imports.join("\n")).toContain("commit");
    });

    test("compiles a top-level `~` cut in the start rule's own pattern into commitAtTopLevel(...)-wrapped elements", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "ifStmt",
            createSequence([
              createStringLiteral("if"),
              { type: "Cut" },
              createStringLiteral("cond"),
              createStringLiteral("then"),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'sequence(literal("if"), commitAtTopLevel(literal("cond")), commitAtTopLevel(literal("then")))',
      );
      expect(result.code).not.toContain("commit(literal");
      expect(result.imports.join("\n")).toContain(
        'import { commitAtTopLevel } from "@suzumiyaaoba/tpeg-combinator";',
      );
      // tpeg-core's plain `commit` must NOT also be imported when nothing
      // needs it.
      const coreImportLine = result.imports.find(
        (line) =>
          line.startsWith("import {") &&
          line.includes("@suzumiyaaoba/tpeg-core"),
      );
      expect(coreImportLine).not.toContain("commit");
    });

    test("a cut nested inside a Choice within the start rule is NOT treated as top-level (stays commit(...))", () => {
      // Only a Cut that is a DIRECT element of the start rule's own
      // top-level Sequence qualifies -- one nested inside a Choice (even
      // within the same rule) is not at backtrack depth 0, so it must
      // stay an ordinary `commit`.
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "stmt",
            createChoice([
              createSequence([
                createStringLiteral("if"),
                { type: "Cut" },
                createStringLiteral("cond"),
              ]),
              createStringLiteral("other"),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'sequence(literal("if"), commit(literal("cond")))',
      );
      expect(result.code).not.toContain("commitAtTopLevel");
    });

    test("should generate choice parser", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "bool",
            createChoice([
              createStringLiteral("true"),
              createStringLiteral("false"),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'choice(literal("true"), literal("false"))',
      );
    });

    test("should generate repetition parsers", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "letters",
            createStar(
              createCharacterClass([createCharRange("a", "z")], false),
            ),
          ),
          createRuleDefinition(
            "digits",
            createPlus(
              createCharacterClass([createCharRange("0", "9")], false),
            ),
          ),
          createRuleDefinition(
            "optionalSpace",
            createOptional(createStringLiteral(" ")),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('zeroOrMore(charClass(["a", "z"]))');
      expect(result.code).toContain('oneOrMore(charClass(["0", "9"]))');
      expect(result.code).toContain('optional(literal(" "))');
    });

    test("should generate lookahead parsers", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "positiveCheck",
            createPositiveLookahead(createStringLiteral("test")),
          ),
          createRuleDefinition(
            "negativeCheck",
            createNegativeLookahead(createStringLiteral("test")),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('andPredicate(literal("test"))');
      expect(result.code).toContain('notPredicate(literal("test"))');
    });

    test("should handle labeled expressions", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "namedValue",
            createLabeledExpression("value", createStringLiteral("test")),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('capture("value", literal("test"))');
    });

    test("should handle rule references", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "number",
            createPlus(
              createCharacterClass([createCharRange("0", "9")], false),
            ),
          ),
          createRuleDefinition(
            "expression",
            createChoice([
              createIdentifier("number"),
              createStringLiteral("null"),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('choice(number, literal("null"))');
      expect(result.exports).toEqual(["number", "expression"]);
    });

    test("should handle qualified (cross-module) rule references", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "main",
            createQualifiedIdentifier("math", "expr"),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        "export const main: Parser<any> = math.expr;",
      );
      expect(result.exports).toEqual(["main"]);
    });

    test("should handle complex nested expressions", () => {
      const grammar = createGrammarDefinition(
        "Calculator",
        [],
        [
          createRuleDefinition(
            "factor",
            createChoice([
              createPlus(
                createCharacterClass([createCharRange("0", "9")], false),
              ),
              createGroup(
                createSequence([
                  createStringLiteral("("),
                  createIdentifier("expression"),
                  createStringLiteral(")"),
                ]),
              ),
            ]),
          ),
          createRuleDefinition(
            "expression",
            createSequence([
              createIdentifier("factor"),
              createStar(
                createSequence([
                  createChoice([
                    createStringLiteral("+"),
                    createStringLiteral("-"),
                  ]),
                  createIdentifier("factor"),
                ]),
              ),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      // Should contain complex nested structure
      expect(result.code).toContain("choice(");
      expect(result.code).toContain("sequence(");
      expect(result.code).toContain("oneOrMore(");
      expect(result.code).toContain("zeroOrMore(");
      expect(result.exports).toEqual(["factor", "expression"]);
    });

    test("should include imports when enabled", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("test"))],
      );

      const generator = new TPEGCodeGenerator({
        language: "typescript",
        includeImports: true,
      });
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'import type { Parser } from "@suzumiyaaoba/tpeg-core"',
      );
      expect(result.code).toContain(
        'import { literal } from "@suzumiyaaoba/tpeg-core"',
      );
    });

    test("should exclude imports when disabled", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("test"))],
      );

      const generator = new TPEGCodeGenerator({
        language: "typescript",
        includeImports: false,
      });
      const result = generator.generateGrammar(grammar);

      expect(result.code).not.toContain("import");
    });

    test("should use name prefix when provided", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("test"))],
      );

      const generator = new TPEGCodeGenerator({
        language: "typescript",
        namePrefix: "my_",
      });
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain("export const my_test:");
    });
  });

  describe("generateTypeScriptParser", () => {
    test("should work as convenience function", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("hello", createStringLiteral("hello"))],
      );

      const result = generateTypeScriptParser(grammar);

      expect(result.code).toContain(
        'export const hello: Parser<any> = literal("hello");',
      );
      expect(result.imports.length).toBeGreaterThan(0);
      expect(result.exports).toEqual(["hello"]);
    });

    test("should accept options", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("test"))],
      );

      const result = generateTypeScriptParser(grammar, {
        namePrefix: "prefix_",
        includeTypes: false,
      });

      expect(result.code).toContain("export const prefix_test =");
      expect(result.code).not.toContain("Parser<any>");
    });
  });

  describe("escape handling", () => {
    test("should properly escape string literals", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "escaped",
            createStringLiteral('quotes"and\\backslashes'),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain('literal("quotes\\"and\\\\backslashes")');
    });
  });

  describe("transform integration", () => {
    test("should apply a matching TypeScript transform function to a rule's parse result", async () => {
      const core = await import("@suzumiyaaoba/tpeg-core");

      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "number",
            createLabeledExpression(
              "digits",
              createPlus(
                createCharacterClass([createCharRange("0", "9")], false),
              ),
            ),
          ),
        ],
        [
          createTransformDefinition(
            createTransformSet("Evaluator", "typescript", [
              createTransformFunction(
                "number",
                [createTransformParameter("captures", "{ digits: string[] }")],
                createTransformReturnType("Result", "number"),
                `
    const value = parseInt(captures.digits.join(""), 10);
    if (isNaN(value)) {
      return { success: false, error: "Invalid number format" };
    }
    return { success: true, value };
  `,
              ),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      const body = result.code
        .replace(/^import[^\n]*\n?/gm, "")
        .replace(/^export const (\w+): Parser<[^>]*>/gm, "const $1");
      const moduleFactory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { number };`,
      );
      const { number } = moduleFactory(...Object.values(core));

      const pos = { offset: 0, column: 0, line: 1 };
      expect(number("123abc", pos)).toEqual({
        success: true,
        val: 123,
        current: { offset: 0, column: 0, line: 1 },
        next: { offset: 3, column: 3, line: 1 },
      });
      expect(number("abc", pos).success).toBe(false);
    });

    test("should leave a rule without a matching transform function unaffected", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("hello", createStringLiteral("hello"))],
        [
          createTransformDefinition(
            createTransformSet("Evaluator", "typescript", [
              createTransformFunction(
                "unrelatedRule",
                [createTransformParameter("captures", "string")],
                createTransformReturnType("Result", "string"),
                "return { success: true, value: captures };",
              ),
            ]),
          ),
        ],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'export const hello: Parser<any> = literal("hello");',
      );
    });
  });

  describe("recursive rule references", () => {
    test("wraps a forward/mutual reference in lazy() and imports lazy", () => {
      // a = "(" b ")"
      // b = a / "x"
      // `b` is declared after `a`, so a plain `b` reference in `a`'s
      // initializer would throw "Cannot access 'b' before initialization".
      const grammar = createGrammarDefinition(
        "Rec",
        [],
        [
          createRuleDefinition(
            "a",
            createSequence([
              createStringLiteral("("),
              createIdentifier("b"),
              createStringLiteral(")"),
            ]),
          ),
          createRuleDefinition(
            "b",
            createChoice([createIdentifier("a"), createStringLiteral("x")]),
          ),
        ],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'export const a: Parser<any> = sequence(literal("("), lazy(() => b), literal(")"));',
      );
      expect(result.code).toContain(
        'export const b: Parser<any> = choice(a, literal("x"));',
      );
      expect(result.imports.join("\n")).toContain("lazy");
    });

    test("does not wrap a reference to an already-declared earlier rule", () => {
      // number = [0-9]+
      // term = number
      // `number` is declared before `term` refers to it, so the reference
      // is safe as a plain identifier - no lazy() indirection needed.
      const grammar = createGrammarDefinition(
        "NonRec",
        [],
        [
          createRuleDefinition(
            "number",
            createCharacterClass([createCharRange("0", "9")], false),
          ),
          createRuleDefinition("term", createIdentifier("number")),
        ],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain("export const term: Parser<any> = number;");
      expect(result.imports.join("\n")).not.toContain("lazy");
    });
  });

  describe("control characters in character classes", () => {
    test("escapes tab/newline/carriage-return instead of embedding raw bytes", () => {
      const grammar = createGrammarDefinition(
        "Whitespace",
        [],
        [
          createRuleDefinition(
            "ws",
            createCharacterClass(
              [
                createCharRange(" "),
                createCharRange("\t"),
                createCharRange("\n"),
                createCharRange("\r"),
              ],
              false,
            ),
          ),
        ],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      // A raw control byte here would make this generated source invalid
      // TypeScript (an unterminated string literal).
      expect(result.code).toContain(
        'export const ws: Parser<any> = charClass(" ", "\\t", "\\n", "\\r");',
      );
    });
  });

  describe("@memoize rule annotation", () => {
    test("wraps a rule carrying a bare `@memoize` flag in an unbounded memoize(...)", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("expr", createStringLiteral("x"), undefined, [
            { type: "GrammarAnnotation", key: "memoize", value: "" },
          ]),
        ],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'export const expr: Parser<any> = memoize(literal("x"));',
      );
      expect(result.imports.join("\n")).toContain(
        'import { memoize } from "@suzumiyaaoba/tpeg-combinator";',
      );
    });

    test("wraps a rule carrying `@memoize: N` with maxCacheSize", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("expr", createStringLiteral("x"), undefined, [
            { type: "GrammarAnnotation", key: "memoize", value: "256" },
          ]),
        ],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.code).toContain(
        'export const expr: Parser<any> = memoize(literal("x"), { maxCacheSize: 256 });',
      );
    });

    test("does not import memoize when no rule uses @memoize", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("expr", createStringLiteral("x"))],
        [],
      );

      const generator = new TPEGCodeGenerator();
      const result = generator.generateGrammar(grammar);

      expect(result.imports.join("\n")).not.toContain("memoize");
    });

    test("an @memoize-annotated rule actually reuses a cached result at runtime instead of re-running its pattern", async () => {
      const core = await import("@suzumiyaaoba/tpeg-core");
      const combinator = await import("@suzumiyaaoba/tpeg-combinator");

      // `tick` is an externally-supplied parser (not defined by this
      // grammar) that counts how many times it actually runs - the
      // generated `counted` rule references it unresolved, same as
      // `math.expr` elsewhere in this file.
      let calls = 0;
      const tick = (_input: string, pos: { offset: number }) => {
        calls++;
        return { success: true as const, val: "t", current: pos, next: pos };
      };

      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "counted",
            createSequence([
              createIdentifier("tick"),
              createStringLiteral("x"),
            ]),
            undefined,
            [{ type: "GrammarAnnotation", key: "memoize", value: "" }],
          ),
        ],
        [],
      );

      const result = generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      });

      const body = result.code.replace(/^export const (\w+)/gm, "const $1");
      const moduleFactory = new Function(
        ...Object.keys(core),
        ...Object.keys(combinator),
        "tick",
        `${body}\nreturn { counted };`,
      );
      const { counted } = moduleFactory(
        ...Object.values(core),
        ...Object.values(combinator),
        tick,
      );

      const pos = { offset: 0, line: 1, column: 1 };
      const first = counted("x", pos);
      const second = counted("x", pos);

      expect(first.success).toBe(true);
      expect(second).toEqual(first);
      // Without memoization this would be 2 - the whole point of
      // `@memoize` is that the second call at the same position is served
      // from cache instead of re-running `tick "x"`.
      expect(calls).toBe(1);
    });
  });

  describe("`~` cut/commit operator (runtime)", () => {
    test("a fatal failure after a cut prevents the enclosing choice from falling back to a sibling alternative", async () => {
      const core = await import("@suzumiyaaoba/tpeg-core");

      // stmt = "i" ~ "f"    -- committed once "i" has matched
      //      / "i"          -- would otherwise match "ix" as bare "i"
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "stmt",
            createChoice([
              createSequence([
                createStringLiteral("i"),
                { type: "Cut" },
                createStringLiteral("f"),
              ]),
              createStringLiteral("i"),
            ]),
          ),
        ],
        [],
      );

      const result = generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      });

      const body = result.code.replace(/^export const (\w+)/gm, "const $1");
      const moduleFactory = new Function(
        ...Object.keys(core),
        `${body}\nreturn { stmt };`,
      );
      const { stmt } = moduleFactory(...Object.values(core));

      const pos = { offset: 0, line: 1, column: 1 };
      const matched = stmt("if", pos);
      expect(matched.success).toBe(true);

      // Without the cut, this would fall back to the second alternative
      // and succeed by matching just "i".
      const committed = stmt("ix", pos);
      expect(committed.success).toBe(false);
    });
  });
});

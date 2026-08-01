/**
 * Tests for semantic action expressions: `expr { code }` attached to an
 * alternative.
 */

import { describe, expect, test } from "bun:test";
import { type Parser, parse } from "@suzumiyaaoba/tpeg-core";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { expression } from "./composition";
import { grammarDefinition } from "./grammar";
import {
  createActionExpression,
  createCharRange,
  createCharacterClass,
  createGrammarDefinition,
  createLabeledExpression,
  createPlus,
  createRuleDefinition,
  createSequence,
  createStringLiteral,
} from "./types";
import type {
  ActionExpression,
  Choice,
  LabeledExpression,
  Sequence,
} from "./types";

const testParse = <T>(parser: Parser<T>, input: string) => parse(parser)(input);

describe("ActionExpression parsing", () => {
  test("attaches an action to a single labeled expression", () => {
    const result = testParse(
      expression(),
      'digits:[0-9]+ { return digits.join(""); }',
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const action = result.val as ActionExpression;
    expect(action.type).toBe("ActionExpression");
    expect(action.code.trim()).toBe('return digits.join("");');
    expect(action.expression.type).toBe("LabeledExpression");
    expect((action.expression as LabeledExpression).label).toBe("digits");
  });

  test("attaches an action to a multi-label sequence", () => {
    const result = testParse(
      expression(),
      'left:"a" right:"b" { return left + right; }',
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const action = result.val as ActionExpression;
    expect(action.type).toBe("ActionExpression");
    expect(action.expression.type).toBe("Sequence");
    expect((action.expression as Sequence).elements).toHaveLength(2);
    expect(action.code.trim()).toBe("return left + right;");
  });

  test("attaches independent actions to each choice alternative", () => {
    const result = testParse(
      expression(),
      '"a" { return 1; } / "b" { return 2; }',
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.val.type).toBe("Choice");
    const choiceExpr = result.val as Choice;
    expect(choiceExpr.alternatives).toHaveLength(2);
    expect(choiceExpr.alternatives[0]?.type).toBe("ActionExpression");
    expect((choiceExpr.alternatives[0] as ActionExpression).code.trim()).toBe(
      "return 1;",
    );
    expect((choiceExpr.alternatives[1] as ActionExpression).code.trim()).toBe(
      "return 2;",
    );
  });

  test("leaves expressions without a trailing action untouched", () => {
    const result = testParse(expression(), '"a" "b"');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.val.type).toBe("Sequence");
  });

  test("action code may contain a brace inside a string literal", () => {
    const result = testParse(expression(), '"a" { return "}"; }');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const action = result.val as ActionExpression;
    expect(action.code.trim()).toBe('return "}";');
  });

  test("action code may span multiple lines with nested braces", () => {
    const result = testParse(
      expression(),
      'digits:[0-9]+ {\n  const value = { parsed: parseInt(digits.join("")) };\n  return value.parsed;\n}',
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const action = result.val as ActionExpression;
    expect(action.code).toBe(
      '\n  const value = { parsed: parseInt(digits.join("")) };\n  return value.parsed;\n',
    );
  });
});

describe("ActionExpression inside a full grammar block", () => {
  test("parses a rule with a multi-line action without truncating the rule or the block", () => {
    const source = `grammar Foo {
  number = digits:[0-9]+ {
    const value = { parsed: parseInt(digits.join("")) };
    return value.parsed;
  }
}`;

    const result = testParse(grammarDefinition, source);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.val.rules).toHaveLength(1);
    const rule = result.val.rules[0];
    expect(rule?.name).toBe("number");
    expect(rule?.pattern.type).toBe("ActionExpression");
    const action = rule?.pattern as ActionExpression;
    expect(action.code).toContain("return value.parsed;");
  });

  test("parses multiple rules where an earlier one has an action", () => {
    const source = `grammar Foo {
  number = digits:[0-9]+ { return parseInt(digits.join("")); }
  greeting = "hello"
}`;

    const result = testParse(grammarDefinition, source);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.val.rules).toHaveLength(2);
    expect(result.val.rules[0]?.name).toBe("number");
    expect(result.val.rules[0]?.pattern.type).toBe("ActionExpression");
    expect(result.val.rules[1]?.name).toBe("greeting");
    expect(result.val.rules[1]?.pattern.type).toBe("StringLiteral");
  });

  test("a character class containing braces doesn't confuse the action/rule boundary scan", () => {
    // `sep`'s character class holds literal "{"/"}" characters - the same
    // characters the boundary scanner in grammar.ts tracks to find a
    // multi-line action's end. This grammar exercises both the `[...]` skip
    // and the brace-depth tracker in the same pass, since `number`'s action
    // is itself multi-line with its own nested braces.
    const source = `grammar Foo {
  sep = [{}]
  number = digits:[0-9]+ {
    const value = { parsed: parseInt(digits.join("")) };
    return value.parsed;
  }
}`;

    const result = testParse(grammarDefinition, source);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.val.rules).toHaveLength(2);
    expect(result.val.rules[0]?.name).toBe("sep");
    expect(result.val.rules[0]?.pattern.type).toBe("CharacterClass");
    expect(result.val.rules[1]?.name).toBe("number");
    expect(result.val.rules[1]?.pattern.type).toBe("ActionExpression");
    const action = result.val.rules[1]?.pattern as ActionExpression;
    expect(action.code).toContain("return value.parsed;");
  });
});

describe("ActionExpression code generation (runtime)", () => {
  test("an action on a single labeled expression can transform its captured value", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "number",
          createActionExpression(
            createLabeledExpression(
              "digits",
              createPlus(createCharacterClass([createCharRange("0", "9")])),
            ),
            'return parseInt(digits.join(""), 10);',
          ),
        ),
      ],
    );

    const result = generateTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: false,
    });

    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { number };`,
    );
    const { number } = moduleFactory(...Object.values(core));

    const parsed = number("123abc", { offset: 0, line: 1, column: 1 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.val).toBe(123);
    }
  });

  test("an action on a multi-label sequence can reference each label by name", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "pair",
          createActionExpression(
            createSequence([
              createLabeledExpression("left", createStringLiteral("a")),
              createLabeledExpression("right", createStringLiteral("b")),
            ]),
            "return `${left}-${right}`;",
          ),
        ),
      ],
    );

    const result = generateTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: false,
    });
    expect(result.code).toContain("captureSequence(");

    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { pair };`,
    );
    const { pair } = moduleFactory(...Object.values(core));

    const parsed = pair("ab", { offset: 0, line: 1, column: 1 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.val).toBe("a-b");
    }
  });

  test("a failed inner match propagates as failure without running the action", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "number",
          createActionExpression(
            createLabeledExpression(
              "digits",
              createPlus(createCharacterClass([createCharRange("0", "9")])),
            ),
            'return parseInt(digits.join(""), 10);',
          ),
        ),
      ],
    );

    const result = generateTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: false,
    });
    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { number };`,
    );
    const { number } = moduleFactory(...Object.values(core));

    const parsed = number("abc", { offset: 0, line: 1, column: 1 });
    expect(parsed.success).toBe(false);
  });

  test("the optimized code generator supports actions with the same runtime behavior", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "pair",
          createActionExpression(
            createSequence([
              createLabeledExpression("left", createStringLiteral("a")),
              createLabeledExpression("right", createStringLiteral("b")),
            ]),
            "return `${left}-${right}`;",
          ),
        ),
      ],
    );

    const result = generateOptimizedTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: false,
    });
    expect(result.code).toContain("captureSequence(");

    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { pair };`,
    );
    const { pair } = moduleFactory(...Object.values(core));

    const parsed = pair("ab", { offset: 0, line: 1, column: 1 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.val).toBe("a-b");
    }
  });

  test("with includeTypes, $$ is typed as any (real generated files must pass tsc, not just run)", () => {
    // Regression test: captureSequence()'s TS return type is a union of the
    // merged capture object and a positional tuple, so an untyped `$$`
    // fails `tsc --noEmit` (TS2339) when a multi-label action destructures
    // it - even though the generated code runs correctly (this package's
    // other runtime tests all use `new Function`, which never typechecks
    // anything, so this class of bug was invisible until a real .ts file
    // generated from a multi-label action was actually compiled).
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "pair",
          createActionExpression(
            createSequence([
              createLabeledExpression("left", createStringLiteral("a")),
              createLabeledExpression("right", createStringLiteral("b")),
            ]),
            "return left + right;",
          ),
        ),
      ],
    );

    const withTypes = generateTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: true,
    });
    expect(withTypes.code).toContain("const $$: any = __result.val;");

    // includeTypes: false must stay free of type syntax entirely, so the
    // output remains valid to run directly (e.g. via `new Function`, as
    // this file's other tests do) without a TypeScript transpile step.
    const withoutTypes = generateTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: false,
    });
    expect(withoutTypes.code).not.toContain(": any");
    expect(withoutTypes.code).toContain("const $$ = __result.val;");
  });

  test("an action that never references its match doesn't leave $$ unused", () => {
    // Regression test: `tsc --noEmit` under noUnusedLocals fails a real
    // generated file if `$$` is declared but the action ignores it.
    const grammar = createGrammarDefinition(
      "TestGrammar",
      [],
      [
        createRuleDefinition(
          "always1",
          createActionExpression(createStringLiteral("a"), "return 1;"),
        ),
      ],
    );

    const result = generateTypeScriptParser(grammar, {
      includeImports: false,
      includeTypes: true,
    });
    expect(result.code).not.toContain("$$");
  });
});

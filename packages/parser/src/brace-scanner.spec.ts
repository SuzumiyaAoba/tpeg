/**
 * Regression tests for the shared regex-vs-division tracker
 * (`createJsExprTracker`) behind `scanBalancedBraces`,
 * `codeContainsIdentifier`, and `grammarRuleExpression`'s boundary scan.
 *
 * The pre-tracker heuristic treated every `)` and `]` as "an operand just
 * ended", so `/` after them was always scanned as DIVISION -- which broke
 * in both directions:
 *
 * - `if (ok) /}/.test(s)` -- the regex (legally in statement position
 *   after a control paren) was mis-scanned as division, so the `}` inside
 *   it decremented the brace depth and truncated the action block.
 * - `{v: 1} / $$ / 2` -- the `}` ending an OBJECT LITERAL (an operand
 *   end, so `/` IS division there) was misread as a block end (statement
 *   boundary), so the division `/` was scanned as a regex open and the
 *   `$$` between the two slashes was never seen.
 * - `arr[i] / $$ / 2` -- same missed-`$$` shape via `]`.
 * - `if (x) /$$/` -- same truncated-block shape via `)`, this time
 *   producing a FALSE `$$` hit (the regex's own text was scanned as
 *   code).
 */

import { describe, expect, test } from "vite-plus/test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import {
  codeContainsIdentifier,
  isJsIdentifierStart,
  scanBalancedBraces,
  scanRegexLiteral,
} from "./brace-scanner";
import { grammarDefinition } from "./grammar";
import {
  objectMethodModifierFixtures,
  objectMethodReferenceFixtures,
} from "../test-fixtures/object-methods.mjs";

describe("JavaScript identifier spelling and property names", () => {
  test.each([
    ["return \\u0024\\u0024;", "$$"],
    ["return v\\u0061lue;", "value"],
    ["return \\u{76}alue;", "value"],
    ['return e\\u0076al("value");', "eval"],
    ["return \\u{1d49c}foo;", "𝒜foo"],
    ["return π;", "π"],
    ["return a\\u200cb;", "a\u200cb"],
    ["return a\\u{200d}b;", "a\u200db"],
  ])("detects the binding in %s", (code, name) => {
    expect(codeContainsIdentifier(code, name)).toBe(true);
  });

  test.each(["πvalue", "𝒜value", "valueπ"])(
    "does not find an ASCII suffix or prefix inside %s",
    (word) => {
      expect(codeContainsIdentifier(`return ${word};`, "value")).toBe(false);
    },
  );

  test.each([
    "return { value: 1 };",
    "return { value /* comment */ : 1 };",
    "return { value() { return 1; } };",
    "return { get value() { return 1; } };",
    "return { set value(input) { console.log(input); } };",
    "return { async value() { return 1; } };",
    "class Read { value() { return 1; } }",
    "class Read { get value() { return 1; } }",
    "class Read { static value = 1; }",
    "class Read { value; }",
    "class Read { #value() { return 1; } run() { return this.#value(); } }",
    "class Read { key = 1\n value() { return 1; } }",
    "class Read { key = 1 /*\n*/ value() { return 1; } }",
  ])("does not treat a named property as a binding: %s", (code) => {
    expect(codeContainsIdentifier(code, "value")).toBe(false);
  });

  test.each([
    "return { value };",
    "return { [value]: 1 };",
    "return { key: [0, value] };",
    "return { key: fn(0, value) };",
    "class Read { static key = value; }",
    "class Read { [value]() { return 1; } }",
    "class Read extends factory({ key: value }) {}",
    "return class {} / value / 2;",
  ])("keeps real object property references: %s", (code) => {
    expect(codeContainsIdentifier(code, "value")).toBe(true);
  });

  test.each([
    'return { key: eval("value") };',
    'return { key: fn(0, eval("value")) };',
    'return { key: [0, eval("value")] };',
  ])("keeps direct eval in an object value: %s", (code) => {
    expect(codeContainsIdentifier(code, "eval")).toBe(true);
  });

  test.each([
    "\\u{}",
    "\\u{110000}",
    "\\u{61",
    "\\u00xz",
    "\\u002d",
    "\\u0030",
  ])("rejects an invalid identifier start: %s", (code) => {
    expect(isJsIdentifierStart(code, 0)).toBe(false);
  });
});

describe("Object method modifiers", () => {
  test.each(objectMethodModifierFixtures)("ignores $name", (fixture) => {
    expect(
      codeContainsIdentifier(
        fixture.body.replaceAll("__VALUE__", "a").replaceAll("__TYPE__", ""),
        fixture.label,
      ),
    ).toBe(false);
  });
  test.each(objectMethodReferenceFixtures)("preserves $name", (fixture) => {
    const body = fixture.body
      .replaceAll("__VALUE__", "a")
      .replaceAll("__JOIN__", "")
      .replaceAll("__TYPE__", "");
    expect(codeContainsIdentifier(body, fixture.label)).toBe(true);
  });
});

describe("Generator method keys and multiplication", () => {
  test.each([
    "return { *value() { yield 1; } };",
    "return { async *value() { yield 1; } };",
    "class Read { *value() { yield 1; } }",
    "class Read { static *value() { yield 1; } }",
    "class Read { async *value() { yield 1; } }",
    "class Read { static async *value() { yield 1; } }",
    "class Read { field = 1;\n *value() { yield 1; } }",
    "return { *v\\u0061lue() { yield 1; } };",
  ])("does not count a generator method key: %s", (code) => {
    expect(codeContainsIdentifier(code, "value")).toBe(false);
  });

  test.each([
    "return { *method() { yield value; } };",
    "class Read { *method() { yield value; } }",
    "return { *class() { value; yield 1; } };",
    "class Read { *class() { value; yield 1; } }",
    "return { *[value]() { yield 1; } };",
    "class Read { *[value]() { yield 1; } }",
    "return { key: async * value };",
    "return { key: get * value };",
    "return { key: set * value };",
    "class Read { key = async * value; }",
    "class Read { key = get * value; }",
    "class Read { key = set * value; }",
    "class Read { key = async\n * value; }",
    "class Read { key = get\n * value; }",
    "class Read { key = 1\n * value; }",
  ])("preserves a real binding reference: %s", (code) => {
    expect(codeContainsIdentifier(code, "value")).toBe(true);
  });
});

describe("JavaScript line terminators", () => {
  test.each(["\n", "\r", "\u2028", "\u2029"])(
    "finds an identifier after a line comment ending with %j",
    (newline) => {
      expect(
        codeContainsIdentifier(`// ignored${newline}return $$;`, "$$"),
      ).toBe(true);
    },
  );

  test.each(["\n", "\r", "\u2028", "\u2029"])(
    "closes an action block after a line comment ending with %j",
    (newline) => {
      const body = ` // ignored${newline}return 1; `;
      expect(scanBalancedBraces(`{${body}}`, 0)).toEqual({
        success: true,
        val: body,
        current: 0,
        next: body.length + 2,
      });
    },
  );

  test.each(["\n", "\r", "\u2028", "\u2029"])(
    "rejects a line terminator in a regex literal: %j",
    (newline) => {
      expect(scanRegexLiteral(`/x${newline}/`, 0)).toBe(-1);
    },
  );

  test.each(["\n", "\r", "\u2028", "\u2029"])(
    "rejects an escaped line terminator in a regex literal: %j",
    (newline) => {
      expect(scanRegexLiteral(`/x\\${newline}/`, 0)).toBe(-1);
    },
  );
});

describe("codeContainsIdentifier: `$$` detection across the regex/division boundary", () => {
  test("finds `$$` used as a real operand after a call paren (division, not regex)", () => {
    // `f(x)` is a call/grouping paren -- `/` after it is division, so the
    // `$$` between the slashes IS a use of the capture object.
    expect(codeContainsIdentifier("return f(x) / $$ / 2;", "$$")).toBe(true);
  });

  test("finds `$$` after an object-literal `}` (an operand end -- `/` is division)", () => {
    // `{v: 1}` is an object literal, so `/ $$ /` is division and `$$`
    // is real code -- previously misread as a regex because `}` was
    // always treated as a statement-ending block close.
    expect(codeContainsIdentifier("return {v: 1} / $$ / 2;", "$$")).toBe(true);
  });

  test("finds `$$` after `]` (an index expression's operand end)", () => {
    expect(codeContainsIdentifier("return arr[i] / $$ / 2;", "$$")).toBe(true);
  });

  test("does NOT report `$$` inside a regex that follows a control-statement paren", () => {
    // `if (x) /$$/` -- `)` ends a STATEMENT paren, so `/` opens a regex
    // and `$$` is pattern text, not a `$$` reference.
    expect(codeContainsIdentifier("if (x) /$$/.test(s);", "$$")).toBe(false);
  });

  test("does NOT report `$$` inside a regex after `return` (keyword keeps expression position)", () => {
    expect(codeContainsIdentifier("return /$$/;", "$$")).toBe(false);
  });

  test("finds identifiers used in division after a keyword used as a property name", () => {
    // `x.in` / `x.return` / `x.case` are legal member expressions whose
    // property name happens to be a regex-prefix keyword. The `/` after
    // them is DIVISION (the member expression is an operand end), so the
    // operand between the slashes is real code -- previously the
    // keyword check ignored property position and scanned `/re/` as a
    // regex literal, hiding `re`/`$$` from detection.
    expect(codeContainsIdentifier("x.in / re / y", "re")).toBe(true);
    expect(codeContainsIdentifier("x.in / $$ / y", "$$")).toBe(true);
    expect(codeContainsIdentifier("x.return / $$ / y", "$$")).toBe(true);
    expect(codeContainsIdentifier("x.case / $$ / y", "$$")).toBe(true);
    expect(codeContainsIdentifier("obj.instanceof / $$ / 2", "$$")).toBe(true);
  });

  test("still scans a regex correctly after a keyword in statement position", () => {
    // Control: a keyword NOT in property position still opens regex
    // position, so `$$` inside is pattern text.
    expect(codeContainsIdentifier("x instanceof /$$/", "$$")).toBe(false);
    expect(codeContainsIdentifier("throw /$$/;", "$$")).toBe(false);
  });

  test("does NOT report `$$` inside a string literal", () => {
    expect(codeContainsIdentifier('return "$$";', "$$")).toBe(false);
  });

  test("does NOT report `$$` inside a line comment", () => {
    expect(codeContainsIdentifier("return x; // $$ used here", "$$")).toBe(
      false,
    );
  });

  test("finds `$$` in a plain action body (control)", () => {
    expect(codeContainsIdentifier("return $$;", "$$")).toBe(true);
  });

  test("does NOT report `$$` inside a regex following a leading `{ }` block statement", () => {
    // At the start of a `{ ... }` action/transform body the scan is in
    // STATEMENT position, so a leading `{ }` is a nested block (not an
    // object literal) and `/$$/` after it opens a regex literal -- `$$`
    // is pattern text. Before `createJsExprTracker` learned the
    // statement/expression distinction, the leading `{` was always
    // classified as an object literal, so `}` ended an "operand", `/`
    // was scanned as division, and `$$` produced a false hit.
    expect(codeContainsIdentifier("{ } /$$/", "$$")).toBe(false);
  });

  test("a `{` first up in EXPRESSION position is an object literal, so `/` after it is division", () => {
    // `${ {a:1} / x / 2 }` interpolates a single expression -- `{a:1}`
    // is an object, both slashes are division, and `x` is a real
    // identifier use. `scanTemplateForIdentifier` passes `false` for
    // exactly this case.
    expect(codeContainsIdentifier("{a:1} / x / 2", "x", false)).toBe(true);
    expect(codeContainsIdentifier("{a:1} / $$ / 2", "$$", false)).toBe(true);
  });

  test("finds identifiers divided out inside a `${ }` interpolation body", () => {
    // The interpolation body is expression code: `{a:1}` object, `/`
    // division, so `x` IS a use -- must not be hidden by scanning
    // `/ x /` as a regex.
    expect(codeContainsIdentifier("return `${ {a:1} / x / 2 }`;", "x")).toBe(
      true,
    );
  });
});

describe("codeContainsIdentifier: member-access identifiers are not binding references", () => {
  test("`x.<name>` is member access, not a use of the destructured binding", () => {
    // `return obj.x;` reads property `x` of `obj` -- it never reads the
    // `const { x } = $$` binding `filterReferencedLabels` is deciding
    // whether to emit, so counting it produced an unused destructure
    // (a `noUnusedLocals` failure on a saved generated file).
    expect(codeContainsIdentifier("return obj.x;", "x")).toBe(false);
    expect(codeContainsIdentifier("return obj?.x;", "x")).toBe(false);
    expect(codeContainsIdentifier("return x . y;", "y")).toBe(false);
    expect(codeContainsIdentifier("return a.b.c;", "b")).toBe(false);
  });

  test("`$$.<label>` still counts `$$` but not the member label", () => {
    // The important real-grammar shape: reading a label through `$$`
    // needs the `const $$` binding (still detected -- `$$` is the
    // object, not the member) but must NOT destructure `<label>`.
    expect(codeContainsIdentifier("return $$.x;", "$$")).toBe(true);
    expect(codeContainsIdentifier("return $$.x;", "x")).toBe(false);
    expect(codeContainsIdentifier("return obj.$$;", "$$")).toBe(false);
  });

  test("a spread `...<name>` IS a reference, not member access", () => {
    // `...` is one punctuator -- the identifier after it is a real use.
    // Treating its final `.` as member access would drop the binding.
    expect(codeContainsIdentifier("return f(...x);", "x")).toBe(true);
    expect(codeContainsIdentifier("return [...x];", "x")).toBe(true);
  });

  test("control: the object of a member expression still counts", () => {
    expect(codeContainsIdentifier("return x.foo;", "x")).toBe(true);
    expect(codeContainsIdentifier("return a.b.c;", "a")).toBe(true);
    // A `?`-then-`:` ternary branch is a reference, not a member name.
    expect(codeContainsIdentifier("return c ? x : y;", "x")).toBe(true);
  });
});

describe("template-interpolation nesting depth cap", () => {
  test("pathologically deep `${`${...}`}` nesting fails gracefully instead of overflowing the stack", () => {
    // Every `` ${`` level is a mutual-recursion hop between
    // skipStringLiteral and scanJsToBlockClose -- direct JS calls, so a
    // deep enough input previously threw `RangeError: Maximum call
    // stack size exceeded` rather than a parse failure. Past
    // `MAX_TEMPLATE_NESTING_DEPTH` (256) the block scans as
    // "unterminated" -- an ordinary failure the caller already handles.
    const deep = `{ return ${"`a${".repeat(30_000)}x${"}`".repeat(30_000)}; }`;
    const result = scanBalancedBraces(deep, 0);
    expect(result.success).toBe(false);
    expect(codeContainsIdentifier(deep, "x")).toBe(false);
  });

  test("nesting within the cap still scans correctly", () => {
    const input = `{ return ${"`a${".repeat(250)}x${"}`".repeat(250)}; }`;
    const result = scanBalancedBraces(input, 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toBe(input.length);
    }
    expect(codeContainsIdentifier(input, "x")).toBe(true);
  });
});

describe("scanBalancedBraces / grammarRuleExpression: a regex after a control paren doesn't truncate the block", () => {
  test("scanBalancedBraces consumes a block containing `if (ok) /}/.test(s)` whole", () => {
    const result = parse(scanBalancedBraces)(
      "{ if (ok) /}/.test(s); return 1; }",
    );
    expect(result.success).toBe(true);
    if (result.success) {
      // `scanBalancedBraces` strips only the enclosing braces, keeping the
      // block's inner text verbatim -- the point is that the `}` inside
      // the regex didn't truncate the scan.
      expect(result.val).toBe(" if (ok) /}/.test(s); return 1; ");
    }
  });

  test("a regex literal after `)` of `if (...)` inside an action body doesn't end the rule early", () => {
    const result = parse(grammarDefinition)(
      'grammar G {\n  a = "x" { if (ok) /}/.test(s); return 1; }\n  b = "y"\n}',
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.rules.map((r) => r.name)).toEqual(["a", "b"]);
    }
  });

  test("an object literal divided by `$$` inside an action body keeps `$$` visible to codegen", () => {
    // `{o:1} / $$ / 2` must be scanned as `object / $$ / 2` (division),
    // so the `$$` IS detected and the action is emitted referencing it --
    // before the tracker, `}` was treated as a block end and the `/`s as
    // a regex, hiding `$$` from `codeContainsIdentifier` entirely.
    const result = parse(grammarDefinition)(
      'grammar G {\n  a = "x" { return {o:1} / $$ / 2; }\n  b = "y"\n}',
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const action = result.val.rules[0]?.pattern;
    expect(action?.type).toBe("ActionExpression");
    if (action?.type === "ActionExpression") {
      expect(codeContainsIdentifier(action.code, "$$")).toBe(true);
    }
  });

  test("scanBalancedBraces consumes a block whose FIRST token is a nested `{ }` followed by a regex", () => {
    // `{ { } /}/ }` is a block containing an empty block statement and a
    // `/}/` regex literal -- the `}` inside the regex must not decrement
    // the brace depth. Before `scanJsToBlockClose` distinguished
    // statement position from `${ }` expression position, the leading
    // `{` was classified as an object literal, `/` scanned as division,
    // and the scan stopped early at the regex's own `}` (returning
    // ` { } /` instead of ` { } /}/ `).
    const result = parse(scanBalancedBraces)("{ { } /}/ }");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe(" { } /}/ ");
      expect(result.next).toBe(11);
    }
  });

  test("an action body starting with a nested block + regex doesn't truncate the rule", () => {
    const result = parse(grammarDefinition)(
      'grammar G {\n  a = "x" { { } /}/; return 1; }\n  b = "y"\n}',
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.rules.map((r) => r.name)).toEqual(["a", "b"]);
    }
  });
});

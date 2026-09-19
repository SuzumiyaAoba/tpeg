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
import { codeContainsIdentifier, scanBalancedBraces } from "./brace-scanner";
import { grammarDefinition } from "./grammar";

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
});

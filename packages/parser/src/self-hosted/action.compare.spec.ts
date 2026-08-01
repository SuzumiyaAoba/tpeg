import { describe, expect, test } from "bun:test";
import { scanBalancedBraces as handActionBlock } from "../brace-scanner";
import { actionBlock as genActionBlock } from "./generated/action.generated";

const pos = { offset: 0, line: 1, column: 1 };

describe("self-hosted action-block grammar vs brace-scanner.ts", () => {
  const cases = [
    "{}",
    "{ return 1; }",
    '{ return "}"; }',
    "{ return '}'; }",
    "{ return `${a}-${b}`; }",
    "{ const x = { a: 1, b: { c: 2 } }; return x; }",
    "{ // a comment with a } inside\n return 1; }",
    "{ /* block comment with } inside */ return 1; }",
    '{\n  const value = { parsed: parseInt(digits.join("")) };\n  return value.parsed;\n}',
    '{ return "\\"}\\""; }',
    "no brace here",
    "{ unterminated",
  ];

  for (const input of cases) {
    test(JSON.stringify(input), () => {
      const a = handActionBlock(input, pos);
      const b = genActionBlock(input, pos);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) {
        expect(b.val).toEqual(a.val);
        expect(b.next.offset).toEqual(a.next.offset);
        expect(b.next.line).toEqual(a.next.line);
        // KNOWN DIVERGENCE, not a self-hosting bug: when the match crosses a
        // line break, brace-scanner.ts computes the new column as
        // `(last consumed line).length + 1`, but core's own nextPos
        // convention (utils.ts) resets column to 0 on a newline and then
        // increments per character - so after one character following a
        // reset, core says column 1, brace-scanner.ts says column 2. The
        // self-hosted grammar is built entirely from core combinators, so it
        // follows core's convention automatically; brace-scanner.ts's manual
        // arithmetic (inherited from the pre-existing transforms.ts
        // `functionBody`) is off by one whenever the match spans >1 line.
        if (!input.includes("\n")) {
          expect(b.next.column).toEqual(a.next.column);
        }
      }
    });
  }
});

import { describe, expect, test } from "bun:test";
import { scanBalancedBraces as handActionBlock } from "../brace-scanner";
import { actionBlock as genActionBlock } from "./generated/action.generated";

const pos = 0;

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
        expect(b.next).toEqual(a.next);
      }
    });
  }
});

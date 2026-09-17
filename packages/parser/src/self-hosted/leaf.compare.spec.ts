import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { describe, expect, test } from "vite-plus/test";
import { characterClass as handCharacterClass } from "../character-class";
import { identifier as handIdentifier } from "../identifier";
import { qualifiedIdentifier as handQualifiedIdentifier } from "../module";
import { stringLiteral as handStringLiteral } from "../string-literal";
import {
  characterClass as genCharacterClass,
  identifier as genIdentifier,
  qualifiedIdentifier as genQualifiedIdentifier,
  stringLiteral as genStringLiteral,
} from "./generated/leaf.generated";

const pos = 0;

/**
 * A generated parser's semantic action has no way to produce a
 * backtrackable ParseFailure, so the self-hosted grammar encodes
 * "reject this input" checks (e.g. charRangePair's backwards-range
 * validation) as thrown Errors -- those propagate out of the generated
 * parser where the hand-written parser returns a (fatal) failure.
 * Both reject the input; normalize a throw to `success: false` so the
 * comparison covers that.
 */
const callGen = (parser: Parser<unknown>, input: string) => {
  try {
    return parser(input, pos);
  } catch {
    return { success: false as const };
  }
};

describe("self-hosted leaf grammar vs hand-written parser", () => {
  describe("stringLiteral", () => {
    const cases = [
      '"hello"',
      "'hello'",
      '""',
      "''",
      '"a b c"',
      '"line\\nbreak"',
      '"tab\\there"',
      '"quote\\"inside"',
      "'apos\\'trophe'",
      '"back\\\\slash"',
      '"unicode: éè"',
      "'mixed \"quotes\" inside single'",
      '"unterminated',
      "123",
    ];
    for (const input of cases) {
      test(JSON.stringify(input), () => {
        const a = handStringLiteral(input, pos);
        const b = genStringLiteral(input, pos);
        expect(a.success).toBe(b.success);
        if (a.success && b.success) {
          expect(b.val).toEqual(a.val);
          expect(b.next).toEqual(a.next);
        }
      });
    }
  });

  describe("characterClass", () => {
    const cases = [
      "[a-z]",
      "[A-Z]",
      "[0-9]",
      "[^0-9]",
      "[abc]",
      "[a-zA-Z0-9_]",
      ".",
      "[\\]]",
      "[\\-]",
      "[\\\\]",
      "[\\^]",
      '["]',
      "[']",
      "[",
      "not-a-class",
      // a backwards range is rejected on both sides (the hand-written
      // parser fails fatally; the generated parser's action throws --
      // see callGen above)
      "[z-a]",
      "[9-0]",
      // non-ASCII (incl. astral) class chars and raw control bytes are
      // accepted raw by both -- matching character-class.ts's ranges
      "[é-ü]",
      "[😀-🙏]",
      "[\u0001]",
      "[\n]",
    ];
    for (const input of cases) {
      test(JSON.stringify(input), () => {
        const a = handCharacterClass(input, pos);
        const b = callGen(genCharacterClass, input);
        expect(a.success).toBe(b.success);
        if (a.success && b.success) {
          expect(b.val).toEqual(a.val);
          expect(b.next).toEqual(a.next);
        }
      });
    }
  });

  describe("identifier", () => {
    const cases = ["expression", "_private", "rule123", "a", "123abc", ""];
    for (const input of cases) {
      test(JSON.stringify(input), () => {
        const a = handIdentifier(input, pos);
        const b = genIdentifier(input, pos);
        expect(a.success).toBe(b.success);
        if (a.success && b.success) {
          expect(b.val).toEqual(a.val);
          expect(b.next).toEqual(a.next);
        }
      });
    }
  });

  describe("qualifiedIdentifier", () => {
    const cases = ["module.rule", "a.b", "onlyone", "a.b.c"];
    for (const input of cases) {
      test(JSON.stringify(input), () => {
        const a = handQualifiedIdentifier(input, pos);
        const b = genQualifiedIdentifier(input, pos);
        expect(a.success).toBe(b.success);
        if (a.success && b.success) {
          expect(b.val).toEqual(a.val);
          expect(b.next).toEqual(a.next);
        }
      });
    }
  });
});

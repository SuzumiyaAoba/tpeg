import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import {
  choice,
  commit,
  literal,
  map,
  optional,
} from "@suzumiyaaoba/tpeg-core";
import { commaSeparated, commaSeparated1, sepBy, sepBy1 } from "./list";

describe("list combinators", () => {
  describe("sepBy", () => {
    it("should parse multiple items", () => {
      const parser = sepBy(literal("a"), literal(","));
      const result = parse(parser)("a,a,a");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a", "a"]);
      }
    });

    it("should parse zero items", () => {
      const parser = sepBy(literal("a"), literal(","));
      const result = parse(parser)("b");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual([]);
        expect(result.next).toBe(0);
      }
    });

    it("propagates a fatal (cut/commit) failure from `value` instead of swallowing it into the empty-list fallback", () => {
      // Regression test: `sepBy`'s internal "or empty" fallback used to be
      // a `choice(...)`, which absorbs `fatal` at its own boundary --
      // silently letting an ENCLOSING choice fall back to a sibling
      // alternative it should have been barred from trying. `sepBy` is
      // meant to be transparent sugar for `sepBy1(...)?`, so a cut inside
      // `value` should propagate past `sepBy` itself.
      const committedA = commit(literal("a"));
      const parser = choice(sepBy(committedA, literal(",")), literal("b"));
      const result = parse(parser)("b");
      expect(result.success).toBe(false);
      // Directly assert `sepBy` itself failed FATALLY, not just that the
      // overall `choice` failed for some other reason (`choice`'s own
      // fatal-absorption already makes `success: false` here strong
      // evidence on its own -- the fallback `literal("b")` WOULD have
      // matched input "b" had `choice` tried it -- but asserting the flag
      // directly makes that reasoning explicit rather than implicit).
      const direct = sepBy(committedA, literal(","))("b", 0);
      expect(direct.success).toBe(false);
      if (!direct.success) {
        expect(direct.error.fatal).toBe(true);
      }
    });

    it("propagates zeroOrMore's own infinite-loop guard instead of silently discarding already-matched elements when both value and separator are nullable (regression: the old `optional(sepByOne)` implementation swallowed that guard's ordinary, non-fatal failure as \"no match\", returning `[]` at zero consumption even though two elements had already matched)", () => {
      const nullableValue = map(optional(literal("a")), (xs) => xs[0] ?? "");
      const nullableSep = map(optional(literal(",")), (xs) => xs[0] ?? "");
      const parser = sepBy(nullableValue, nullableSep);
      const result = parse(parser)("a,a,zzz");
      // Before the fix, this silently succeeded with `val: []` and
      // `next: 0` -- discarding the two "a"s it had already matched, with
      // no indication anything went wrong. It must now fail loudly
      // instead (matching `sepBy1`'s existing, already-correct behavior
      // on the same input).
      expect(result.success).toBe(false);
    });
  });

  describe("sepBy1", () => {
    it("should parse one or more items", () => {
      const parser = sepBy1(literal("a"), literal(","));
      const result = parse(parser)("a,a");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a"]);
      }
    });

    it("should fail on zero items", () => {
      const parser = sepBy1(literal("a"), literal(","));
      const result = parse(parser)("b");
      expect(result.success).toBe(false);
    });

    it("propagates a fatal (cut/commit) failure from value -- unlike sepBy, no hand-rolled short-circuit is needed here since sepBy1 is built directly from seq/zeroOrMore, both of which already relay a fatal failure unchanged", () => {
      const committedA = commit(literal("a"));
      const direct = sepBy1(committedA, literal(","))("b", 0);
      expect(direct.success).toBe(false);
      if (!direct.success) {
        expect(direct.error.fatal).toBe(true);
      }
      // Same enclosing-choice check as sepBy's/commaSeparated's fatal
      // tests: the fallback would otherwise match "b" outright.
      const parser = choice(sepBy1(committedA, literal(",")), literal("b"));
      expect(parse(parser)("b").success).toBe(false);
    });
  });

  describe("commaSeparated", () => {
    it("should parse comma separated values", () => {
      const parser = commaSeparated(literal("a"));
      const result = parse(parser)("a, a, a");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a", "a"]);
      }
    });

    it("should handle trailing comma if allowed", () => {
      const parser = commaSeparated(literal("a"), true);
      const result = parse(parser)("a, a, ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a"]);
      }
    });

    it("should fail on trailing comma if not allowed", () => {
      const parser = commaSeparated(literal("a"), false);
      const result = parse(parser)("a, a, ");

      // If allowTrailing is false, nonEmpty fails because of notPredicate(comma) at the third item.
      // The fallback to 'empty' is then tried (nonEmpty's failure wasn't
      // fatal), but 'empty' also fails because it starts with
      // 'notPredicate(valueParser)', and valueParser matches the first 'a'.
      // So the whole parser fails.
      expect(result.success).toBe(false);
    });

    it("propagates a fatal (cut/commit) failure from valueParser instead of swallowing it into the empty-list fallback", () => {
      // Regression test: `commaSeparated` used to pick between its
      // "nonEmpty" and "empty" cases via `choice(...)`, which absorbs
      // `fatal` at its own boundary -- silently letting an ENCLOSING
      // choice fall back to a sibling alternative it should have been
      // barred from trying.
      const committedA = commit(literal("a"));
      const parser = choice(commaSeparated(committedA), literal("b"));
      const result = parse(parser)("b");
      expect(result.success).toBe(false);
      // Directly assert `commaSeparated` itself failed FATALLY -- see the
      // identical `sepBy` test above for why `success: false` alone is
      // already strong (if indirect) evidence of this.
      const direct = commaSeparated(committedA)("b", 0);
      expect(direct.success).toBe(false);
      if (!direct.success) {
        expect(direct.error.fatal).toBe(true);
      }
    });
  });

  describe("commaSeparated1", () => {
    it("should require at least one item", () => {
      const parser = commaSeparated1(literal("a"));
      const result = parse(parser)("");
      expect(result.success).toBe(false);
    });

    it("should parse multiple items", () => {
      const parser = commaSeparated1(literal("a"));
      const result = parse(parser)("a, a");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual(["a", "a"]);
      }
    });

    it("propagates a fatal (cut/commit) failure from valueParser -- built directly from seq/zeroOrMore, both of which already relay it unchanged", () => {
      const committedA = commit(literal("a"));
      const direct = commaSeparated1(committedA)("b", 0);
      expect(direct.success).toBe(false);
      if (!direct.success) {
        expect(direct.error.fatal).toBe(true);
      }
      const parser = choice(commaSeparated1(committedA), literal("b"));
      expect(parse(parser)("b").success).toBe(false);
    });
  });
});

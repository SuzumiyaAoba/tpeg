import { describe, expect, it } from "vite-plus/test";
import {
  choice,
  lazy,
  literal,
  not,
  parse,
  sequence,
  zeroOrMore,
} from "./index";
import { PARSER_LIMITS } from "./limits";
import type { Parser } from "./types";

describe("PARSER_LIMITS", () => {
  describe("input length limit", () => {
    it("accepts input at the maximum length", () => {
      const input = "a".repeat(PARSER_LIMITS.MAX_INPUT_LENGTH);
      const result = parse(literal(input))(input);
      expect(result.success).toBe(true);
    });

    it("rejects input exceeding the maximum length", () => {
      const input = "a".repeat(PARSER_LIMITS.MAX_INPUT_LENGTH + 1);
      const result = parse(literal("a"))(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("1000001");
        expect(result.error.fatal).toBe(true);
      }
    });
  });

  describe("recursion depth limit", () => {
    // `lazy` defers the recursive call, so the returned parser can
    // reference itself. The value type is the recursive sequence shape
    // `["(", nested, ")"] | "x"`.
    const nested: Parser<unknown> = choice(
      sequence(
        literal("("),
        lazy(() => nested),
        literal(")"),
      ),
      literal("x"),
    );

    const nestedInput = (depth: number) =>
      "(".repeat(depth) + "x" + ")".repeat(depth);

    it("parses input nested below the limit", () => {
      const result = parse(nested)(nestedInput(500));
      expect(result.success).toBe(true);
    });

    it("fails with a recursion-limit error instead of a stack overflow", () => {
      const depth = PARSER_LIMITS.MAX_RECURSION_DEPTH + 500;
      const result = parse(nested)(nestedInput(depth));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain(
          "Recursion depth limit exceeded",
        );
      }
    });

    it("marks the limit failure as fatal and abort", () => {
      const depth = PARSER_LIMITS.MAX_RECURSION_DEPTH + 500;
      const result = nested(nestedInput(depth), 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fatal).toBe(true);
        expect(result.error.abort).toBe(true);
      }
    });

    it("propagates through an enclosing choice instead of being absorbed as a cut", () => {
      const depth = PARSER_LIMITS.MAX_RECURSION_DEPTH + 500;
      // `choice` would otherwise absorb `fatal` at its own boundary; the
      // limit failure must keep aborting the whole parse.
      const parser = choice(nested, literal("fallback"));
      const result = parser(nestedInput(depth), 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.abort).toBe(true);
      }
    });

    it("propagates through negative lookahead instead of becoming a success", () => {
      const depth = PARSER_LIMITS.MAX_RECURSION_DEPTH + 500;
      // `!e` normally turns ANY child failure into a success; a limit hit
      // is not an ordinary failure and must still abort.
      const parser = sequence(not(nested), literal("anything"));
      const result = parser(nestedInput(depth), 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.abort).toBe(true);
      }
    });

    it("propagates through repetition instead of being swallowed as 'no match'", () => {
      const depth = PARSER_LIMITS.MAX_RECURSION_DEPTH + 500;
      const parser = zeroOrMore(nested);
      const result = parser(nestedInput(depth), 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.abort).toBe(true);
      }
    });

    it("resets the depth counter after a failed call so later parses still work", () => {
      const depth = PARSER_LIMITS.MAX_RECURSION_DEPTH + 500;
      const result = nested(nestedInput(depth), 0);
      expect(result.success).toBe(false);
      // The depth counter must not leak: a fresh, shallow parse succeeds.
      const shallow = nested(nestedInput(10), 0);
      expect(shallow.success).toBe(true);
    });
  });
  describe("per-parse overrides (parse(parser, options))", () => {
    const nested: Parser<unknown> = choice(
      sequence(
        literal("("),
        lazy(() => nested),
        literal(")"),
      ),
      literal("x"),
    );
    const nestedInput = (depth: number) =>
      "(".repeat(depth) + "x" + ")".repeat(depth);

    it("maxInputLength raises and lowers the input-length limit", () => {
      const big = "a".repeat(PARSER_LIMITS.MAX_INPUT_LENGTH + 1);
      expect(
        parse(literal(big), { maxInputLength: big.length })(big).success,
      ).toBe(true);
      expect(parse(literal("ab"), { maxInputLength: 1 })("ab").success).toBe(
        false,
      );
    });

    it("maxRecursionDepth applies to that parse only", () => {
      const input = nestedInput(1500);
      expect(parse(nested)(input).success).toBe(false);
      expect(parse(nested, { maxRecursionDepth: 3000 })(input).success).toBe(
        true,
      );
      expect(
        parse(nested, { maxRecursionDepth: 5 })(nestedInput(10)).success,
      ).toBe(false);
      // The override was restored: the default applies again.
      expect(parse(nested)(input).success).toBe(false);
      expect(parse(nested)(nestedInput(10)).success).toBe(true);
    });

    it("rejects invalid limit options up front", () => {
      expect(() => parse(nested, { maxRecursionDepth: 0 })).toThrow(RangeError);
      expect(() => parse(nested, { maxInputLength: 1.5 })).toThrow(RangeError);
      expect(() =>
        parse(nested, { maxInputLength: Number.POSITIVE_INFINITY }),
      ).not.toThrow();
    });
  });
});

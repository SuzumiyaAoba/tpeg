import { describe, expect, it } from "bun:test";
import { regexFused, regexFusedMap } from "./regex-fused";

describe("regexFused", () => {
  it("matches at the given position and returns text + groups", () => {
    const parser = regexFused("([0-9]+)", "digits");
    const result = parser("abc123def", 3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.text).toBe("123");
      expect(result.val.groups).toEqual(["123"]);
      expect(result.next).toBe(6);
      expect(result.current).toBe(3);
    }
  });

  it("is sticky: only matches right at `pos`, never searching forward", () => {
    // The pattern COULD match starting at offset 3, but `pos` is 0 --
    // sticky (`y`) semantics must fail rather than skip ahead to it.
    const parser = regexFused("[0-9]+", "digits");
    const result = parser("abc123", 0);
    expect(result.success).toBe(false);
  });

  it("fails cleanly at end of input", () => {
    const parser = regexFused("[0-9]+", "digits");
    const result = parser("", 0);
    expect(result.success).toBe(false);
  });

  it("reports undefined for a group whose alternative/optional branch didn't participate", () => {
    const parser = regexFused("(?:(a)|(b))", "a-or-b");
    const onA = parser("a", 0);
    expect(onA.success).toBe(true);
    if (onA.success) expect(onA.val.groups).toEqual(["a", undefined]);

    const onB = parser("b", 0);
    expect(onB.success).toBe(true);
    if (onB.success) expect(onB.val.groups).toEqual([undefined, "b"]);
  });

  describe("Unicode (`u` flag) behavior", () => {
    // The module doc comment says the `u` flag is set so "`\u{...}` escapes
    // and per-code-point character classes behave as `char-set.ts`'s
    // code-point-based `CharSet` assumes" -- these pin exactly that claim,
    // which had no test at all before this file.
    const EMOJI = "\u{1F600}"; // 😀 -- a surrogate pair, outside the BMP

    it("matches a `\\u{...}` code-point escape against an astral character", () => {
      const parser = regexFused("\\u{1F600}", "emoji");
      const result = parser(EMOJI, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.text).toBe(EMOJI);
        // Advances by the FULL surrogate pair (2 UTF-16 code units), not 1
        // -- `advancePos` counting the match's own length correctly.
        expect(result.next).toBe(2);
      }
    });

    it("a per-code-point character class range matches an astral character inside it and rejects one outside it", () => {
      // [\u{1F600}-\u{1F64F}] -- the "emoticons" astral block. Without the
      // `u` flag this range would be interpreted over UTF-16 CODE UNITS
      // instead, silently matching/rejecting the wrong things for any
      // character outside the BMP.
      const parser = regexFused("[\\u{1F600}-\\u{1F64F}]", "emoji-range");
      const inRange = parser("\u{1F60A}", 0); // 😊 -- inside the range
      expect(inRange.success).toBe(true);
      if (inRange.success) {
        expect(inRange.val.text).toBe("\u{1F60A}");
        expect(inRange.next).toBe(2);
      }

      const outOfRange = parser("\u{1F389}", 0); // 🎉 -- outside the range
      expect(outOfRange.success).toBe(false);
    });

    it("`.` matches one whole astral character (one code point), not a lone surrogate", () => {
      // Without `u`, `.` matches a single UTF-16 code unit -- i.e. only
      // the LEAD surrogate half of an astral character, leaving a
      // dangling unpaired trail surrogate behind. With `u`, `.` matches
      // the full code point in one step.
      const parser = regexFused(".", "any-char");
      const result = parser(`${EMOJI}x`, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.text).toBe(EMOJI);
        expect(result.next).toBe(2);
      }
    });

    it("captures an astral character inside a group correctly, groups[i] holds the full code point", () => {
      const parser = regexFused("(.)", "captured-any");
      const result = parser(EMOJI, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.groups).toEqual([EMOJI]);
      }
    });
  });
});

describe("regexFusedMap", () => {
  it("matches identically to regexFused, modulo the value shape f produces", () => {
    const raw = regexFused("([0-9]+)", "digits");
    const mapped = regexFusedMap("([0-9]+)", "digits", (m) => Number(m[1]));

    for (const [input, pos] of [
      ["123", 0],
      ["abc123", 3],
      ["", 0],
      ["abc", 0],
    ] as const) {
      const rawResult = raw(input, pos);
      const mappedResult = mapped(input, pos);
      expect(mappedResult.success).toBe(rawResult.success);
      if (rawResult.success && mappedResult.success) {
        expect(mappedResult.next).toBe(rawResult.next);
        expect(mappedResult.current).toBe(rawResult.current);
        expect(mappedResult.val).toBe(Number(rawResult.val.groups[0]));
      }
    }
  });

  it("indexes groups the same way RegExp.exec does: m[0] is the whole match, m[i+1] is capture group i", () => {
    // Mirrors `regex-fusion.ts`'s `emit`: `Sequence` reconstruction reads
    // each element's own group by position, same indexing as a raw
    // `RegExpExecArray`.
    const parser = regexFusedMap(
      "([a-z]+)([0-9]+)",
      "identifier-then-digits",
      (m) => ({ whole: m[0], name: m[1], digits: m[2] }),
    );
    const result = parser("abc123", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual({
        whole: "abc123",
        name: "abc",
        digits: "123",
      });
      expect(result.next).toBe(6);
    }
  });

  it("is sticky and fails cleanly at end of input, matching regexFused", () => {
    const parser = regexFusedMap("[0-9]+", "digits", (m) => m[0]);
    expect(parser("abc123", 0).success).toBe(false);
    expect(parser("", 0).success).toBe(false);
  });

  it("saves the intermediate FusedMatch/ParseSuccess allocations regexFused + map would build -- verified by producing a value shape a Sequence-reconstruction expression needs directly, with no `.groups`/`.text` indirection", () => {
    // Not a literal allocation-count assertion (that would be a
    // micro-benchmark, not a unit test) -- this documents and locks in
    // the actual contract `tryGenerateCharClassRunCode`-style codegen
    // depends on: `f` receives the raw match array, not a `FusedMatch`.
    const parser = regexFusedMap("(a)(b)?", "ab", (m) => [
      m[1],
      m[2] !== undefined ? [m[2]] : [],
    ]);
    const withB = parser("ab", 0);
    expect(withB.success).toBe(true);
    if (withB.success) expect(withB.val).toEqual(["a", ["b"]]);

    const withoutB = parser("a", 0);
    expect(withoutB.success).toBe(true);
    if (withoutB.success) expect(withoutB.val).toEqual(["a", []]);
  });
});

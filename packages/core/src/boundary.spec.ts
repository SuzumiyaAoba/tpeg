import { beforeEach, describe, expect, it } from "vite-plus/test";
import { isWordChar, nonWordBoundary, wordBoundary } from "./boundary";
import { resetFailureWatermark } from "./failure";
import { lit } from "./basic";
import { seq } from "./combinators";
import { zeroOrMore } from "./repetition";
import { parse } from "./utils";

// See `combinators.spec.ts`'s identical `beforeEach` -- the farthest-failure
// watermark (`./failure.ts`) is module-global, keyed by input string VALUE.
beforeEach(() => {
  resetFailureWatermark();
});

describe("isWordChar", () => {
  it("accepts the ASCII regex word set [A-Za-z0-9_]", () => {
    for (const ch of "AZaz09_") {
      expect(isWordChar(ch.charCodeAt(0))).toBe(true);
    }
  });

  it("rejects non-word characters", () => {
    for (const ch of " \t\n\r!@#.-あé😀") {
      expect(isWordChar(ch.charCodeAt(0))).toBe(false);
    }
  });

  it("treats a surrogate pair's code units as non-word (JS \\w semantics)", () => {
    const emoji = "😀"; // U+1F600: lead + trail surrogates
    expect(isWordChar(emoji.charCodeAt(0))).toBe(false);
    expect(isWordChar(emoji.charCodeAt(1))).toBe(false);
  });
});

describe("wordBoundary", () => {
  it("succeeds at start of input when the first character is a word character", () => {
    const result = wordBoundary("abc", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBeUndefined();
      expect(result.current).toBe(0);
      expect(result.next).toBe(0); // zero-width
    }
  });

  it("fails at start of input when the first character is non-word", () => {
    expect(wordBoundary(" abc", 0).success).toBe(false);
    expect(wordBoundary("", 0).success).toBe(false); // both sides non-word
  });

  it("succeeds at end of input when the last character is a word character", () => {
    const result = wordBoundary("abc", 3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toBe(3);
    }
  });

  it("fails at end of input when the last character is non-word", () => {
    expect(wordBoundary("abc ", 4).success).toBe(false);
  });

  it("succeeds between a word and a non-word character (both directions)", () => {
    expect(wordBoundary("a b", 1).success).toBe(true); // a|space
    expect(wordBoundary(" a", 1).success).toBe(true); // space|a
    expect(wordBoundary("a-c", 1).success).toBe(true); // a|-
    expect(wordBoundary("a-c", 2).success).toBe(true); // -|c
    expect(wordBoundary("a\tb", 1).success).toBe(true); // tab
    expect(wordBoundary("a\nb", 1).success).toBe(true); // newline
  });

  it("fails between two word characters", () => {
    expect(wordBoundary("abc", 1).success).toBe(false);
    expect(wordBoundary("a_b", 1).success).toBe(false); // _ is a word char
    expect(wordBoundary("a1b", 1).success).toBe(false);
  });

  it("fails between two non-word characters", () => {
    expect(wordBoundary("a  b", 2).success).toBe(false); // space|space
    expect(wordBoundary(" -- ", 2).success).toBe(false);
    expect(wordBoundary("éa", 0).success).toBe(false); // é is non-word
  });

  it("works at nonzero positions inside a sequence", () => {
    // literal("a") then \b -- "a " matches, "ab" does not.
    const p = seq(lit("a"), wordBoundary);
    const ok = p("a b", 0);
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.next).toBe(1);
    expect(p("ab", 0).success).toBe(false);
  });

  it("succeeds after a surrogate pair (lead+trail both non-word)", () => {
    // Position 2 is between the trail surrogate and "a": non-word | word.
    expect(wordBoundary("😀a", 2).success).toBe(true);
    // Position 1 is inside the pair: lead (non-word) | trail (non-word).
    expect(wordBoundary("😀a", 1).success).toBe(false);
  });

  it("reports a useful expectation on failure", () => {
    const result = wordBoundary("ab", 1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("word boundary");
      expect(result.error.pos).toBe(1);
    }
  });

  it("fails on out-of-contract positions", () => {
    expect(wordBoundary("ab", -1).success).toBe(false);
    expect(wordBoundary("ab", 3).success).toBe(false); // past end
    expect(wordBoundary("ab", Number.NaN).success).toBe(false);
  });
});

describe("nonWordBoundary", () => {
  it("succeeds between two word characters", () => {
    const result = nonWordBoundary("abc", 1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toBe(1);
      expect(result.current).toBe(1);
    }
  });

  it("succeeds between two non-word characters and on empty input", () => {
    expect(nonWordBoundary("a  b", 2).success).toBe(true);
    expect(nonWordBoundary("", 0).success).toBe(true);
  });

  it("fails exactly where wordBoundary succeeds", () => {
    for (const pos of [0, 1, 2, 3]) {
      const wb = wordBoundary("a-b", pos).success;
      const nwb = nonWordBoundary("a-b", pos).success;
      expect(nwb).toBe(!wb);
    }
  });

  it("fails at start/end of input adjacent to a word character", () => {
    expect(nonWordBoundary("abc", 0).success).toBe(false);
    expect(nonWordBoundary("abc", 3).success).toBe(false);
  });
});

describe("word-boundary parsers in composition", () => {
  it("never loops inside a bounded repetition context", () => {
    // `seq(wordBoundary, ...)` inside zeroOrMore -- a zero-width success
    // must still terminate (the repetition's own guard fires if the
    // element parser is the repetition body itself; here the boundary
    // is only a sequence element, and `lit` drives progress).
    const p = zeroOrMore(seq(wordBoundary, lit("a")));
    const result = p("aaa", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      // \b at pos 0 (start|a) ok, then \b between a|a fails -> only one iter.
      expect(result.next).toBe(1);
    }
  });

  it("full parse: \\b-delimited word at both ends", () => {
    const p = seq(wordBoundary, lit("word"), wordBoundary);
    expect(parse(p)("word").success).toBe(true);
    expect(parse(p)("word!").success).toBe(true); // boundary before !
    expect(parse(p)("sword").success).toBe(false); // s|w is non-boundary
    expect(parse(p)("words").success).toBe(false); // d|s is non-boundary
  });
});

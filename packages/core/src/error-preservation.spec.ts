import { describe, expect, it } from "vite-plus/test";
import { captureChoice } from "./capture";
import { choice, commit } from "./combinators";
import { andPredicate } from "./lookahead";
import { optional, zeroOrMore } from "./repetition";
import type { ParseError, Parser } from "./types";

class Diagnostic extends Error implements ParseError {
  get pos() {
    return 1;
  }
  get expected() {
    return "a";
  }
  get found() {
    return "z";
  }
  get parserName() {
    return "custom";
  }
  get context() {
    return "rule";
  }
  get fatal() {
    return true;
  }
  get abort() {
    return false;
  }
}

describe("diagnostic fields when changing cut flags", () => {
  it("propagates a resource abort through choices, lookahead and repetition", () => {
    const error = { message: "limit", pos: 0, abort: true };
    const failure: Parser<string> = () => ({ success: false, error });
    const fallback: Parser<string> = () => {
      throw new Error("unexpected fallback");
    };
    for (const parser of [
      choice(failure, fallback),
      captureChoice(failure, fallback),
      optional(failure),
      zeroOrMore(failure),
      andPredicate(failure),
    ]) {
      expect(parser("", 0)).toEqual({ success: false, error });
    }
  });

  it("absorbs a positive lookahead cut using the first diagnostic it reads", () => {
    let reads = 0;
    const failure: Parser<string> = () => ({
      success: false,
      get error() {
        return { message: "cut", pos: reads++, fatal: true };
      },
    });
    expect(andPredicate(failure)("a", 0)).toMatchObject({
      success: false,
      error: { pos: 0, fatal: false },
    });
    expect(reads).toBe(1);
  });
  it("commit snapshots a concrete failure's error getter only once", () => {
    let reads = 0;
    const failure: Parser<string> = () => ({
      success: false,
      get error() {
        return { message: "diagnostic", pos: reads++ };
      },
    });
    expect(commit(failure)("xz", 0)).toMatchObject({
      success: false,
      error: { pos: 0, fatal: true },
    });
    expect(reads).toBe(1);
  });

  it.each(["commit", "choice", "captureChoice", "andPredicate"])(
    "%s preserves inherited diagnostics and a non-enumerable Error message",
    (kind) => {
      const extra = Symbol("metadata");
      const error = Object.assign(new Diagnostic("custom diagnostic"), {
        detail: "retained",
        [extra]: "symbol metadata",
      });
      const failure: Parser<string> = () => ({ success: false, error });
      let fallbackCalls = 0;
      const fallback: Parser<string> = () => {
        fallbackCalls++;
        return { success: true, val: "fallback", current: 0, next: 1 };
      };
      const parser =
        kind === "commit"
          ? commit(failure)
          : kind === "choice"
            ? choice(failure, fallback)
            : kind === "captureChoice"
              ? captureChoice(failure, fallback)
              : andPredicate(failure);
      const result = parser("xz", 0);
      expect(result).toMatchObject({
        success: false,
        error: {
          message: "custom diagnostic",
          pos: 1,
          expected: "a",
          found: "z",
          parserName: "custom",
          context: "rule",
          fatal: kind === "commit",
          abort: false,
          detail: "retained",
          [extra]: "symbol metadata",
        },
      });
      expect(fallbackCalls).toBe(0);
      expect(error.fatal).toBe(true);
    },
  );

  it.each(["commit", "choice", "captureChoice", "andPredicate"])(
    "%s reads enumerable diagnostic getters only once",
    (kind) => {
      let reads = 0;
      const error: ParseError = {
        message: "diagnostic",
        get pos() {
          return reads++;
        },
        fatal: true,
      };
      const failure: Parser<string> = () => ({ success: false, error });
      const parser =
        kind === "commit"
          ? commit(failure)
          : kind === "choice"
            ? choice(failure)
            : kind === "captureChoice"
              ? captureChoice(failure)
              : andPredicate(failure);
      expect(parser("xz", 0)).toMatchObject({
        success: false,
        error: { pos: 0 },
      });
      expect(reads).toBe(1);
    },
  );
});

import { describe, expect, it } from "vite-plus/test";
import { literal } from "./basic";
import { captureChoice } from "./capture";
import { choice, predictiveChoice, seq } from "./combinators";
import { FAIL, fail } from "./failure";
import { notPredicate } from "./lookahead";
import type { ParseError, Parser } from "./types";
import { createFailure, parse } from "./utils";

const combine = (kind: string, ...parsers: Parser<string>[]): Parser<string> =>
  kind === "captureChoice"
    ? captureChoice(...parsers)
    : kind === "predictiveChoice"
      ? predictiveChoice<[string]>(
          parsers.map((parser) => [parser, null] as const),
        )
      : choice(...parsers);

describe("choice diagnostics without explicit expectations", () => {
  it("reads the concrete error's position getter once when recording it", () => {
    let reads = 0;
    const error: ParseError = {
      message: "custom failure",
      get pos() {
        return reads++;
      },
    };
    expect(
      parse(choice(() => ({ success: false, error })))("abc"),
    ).toMatchObject({
      success: false,
      error: { pos: 0, message: "custom failure" },
    });
    expect(reads).toBe(1);
  });

  it("does not let a materialized context mutate the recorded diagnostic", () => {
    const outer: Parser<string> = (input, pos) => {
      choice(() =>
        createFailure("custom failure", 0, { context: ["original"] }),
      )(input, pos);
      const displayed = FAIL.error;
      if (Array.isArray(displayed.context)) displayed.context.push("changed");
      return FAIL;
    };
    expect(parse(outer)("x")).toMatchObject({
      success: false,
      error: { context: ["original"] },
    });
  });

  it.each(["choice", "captureChoice", "predictiveChoice"])(
    "%s retains a handwritten failure's message, position and metadata",
    (kind) => {
      const error = {
        message: "checksum mismatch",
        pos: 2,
        parserName: "checksum",
        found: "checksum=0",
        context: ["document"],
        detail: 7,
      };
      const failure: Parser<string> = () => ({ success: false, error });
      const result = parse(combine(kind, failure))("abc");
      expect(result).toMatchObject({ success: false, error });
      if (!result.success) expect(result.error.expected).toBeUndefined();
    },
  );

  it("uses the original message when the explicit expectation array is empty", () => {
    const result = parse(
      choice(() =>
        createFailure("custom validation failed", 1, { expected: [] }),
      ),
    )("abc");
    expect(result).toMatchObject({
      success: false,
      error: { pos: 1, message: "custom validation failed" },
    });
  });

  it.each([true, false])(
    "keeps a farther custom failure (custom first: %s)",
    (customFirst) => {
      const custom: Parser<string> = () =>
        createFailure("custom validation failed", 2);
      const leaf = literal("x");
      const result = parse(
        customFirst ? choice(custom, leaf) : choice(leaf, custom),
      )("abc");
      expect(result).toMatchObject({
        success: false,
        error: { pos: 2, message: "custom validation failed" },
      });
    },
  );

  it.each([true, false])(
    "keeps a farther leaf failure (custom first: %s)",
    (customFirst) => {
      const custom: Parser<unknown> = () =>
        createFailure("near custom failure", 0, { context: "near" });
      const leaf: Parser<unknown> = seq(literal("ab"), literal("x"));
      const result = parse(
        customFirst ? choice(custom, leaf) : choice(leaf, custom),
      )("ab?");
      expect(result).toMatchObject({
        success: false,
        error: { pos: 2, expected: '"x"' },
      });
      if (!result.success) {
        expect(result.error.message).not.toContain("near custom failure");
        expect(result.error.context).toBeUndefined();
      }
    },
  );

  it("aggregates tied custom messages without inventing expected values", () => {
    const result = parse(
      choice(
        () => createFailure("first custom failure", 1, { parserName: "first" }),
        () =>
          createFailure("second custom failure", 1, { parserName: "second" }),
      ),
    )("abc");
    expect(result).toMatchObject({ success: false, error: { pos: 1 } });
    if (!result.success) {
      expect(result.error.message).toContain("first custom failure");
      expect(result.error.message).toContain("second custom failure");
      expect(result.error.expected).toBeUndefined();
      expect(result.error.parserName).toBeUndefined();
    }
  });

  it("keeps a custom message distinct from a leaf's equal expectation label", () => {
    const leaf: Parser<string> = (input, pos) =>
      fail(input, pos, { label: "same text" });
    const custom: Parser<string> = () =>
      createFailure("same text", 0, { context: "custom" });
    const result = parse(choice(leaf, custom))("x");
    expect(result).toMatchObject({
      success: false,
      error: { expected: "same text", context: "custom" },
    });
  });

  it("rolls custom diagnostics back after a successful negative lookahead", () => {
    const custom: Parser<string> = () =>
      createFailure("discarded custom failure", 2);
    const result = parse(seq(notPredicate(choice(custom)), literal("!")))(
      "abc",
    );
    expect(result).toMatchObject({
      success: false,
      error: { pos: 0, expected: '"!"' },
    });
    if (!result.success)
      expect(result.error.message).not.toContain("discarded");
  });

  it("restores an outer custom diagnostic after a nested parse", () => {
    const outer: Parser<string> = (input, pos) => {
      choice(() => createFailure("outer failure", 2, { context: "outer" }))(
        input,
        pos,
      );
      parse(choice(() => createFailure("inner failure", 0)))("x");
      return FAIL;
    };
    expect(parse(outer)("abc")).toMatchObject({
      success: false,
      error: { pos: 2, message: "outer failure", context: "outer" },
    });
  });

  it("keeps recorded context independent of later changes to the source error", () => {
    const error: ParseError = {
      message: "custom failure",
      pos: 0,
      context: ["original"],
    };
    const outer: Parser<string> = (input, pos) => {
      choice(() => ({ success: false, error }))(input, pos);
      if (Array.isArray(error.context)) error.context.push("changed");
      error.message = "changed";
      return FAIL;
    };
    expect(parse(outer)("x")).toMatchObject({
      success: false,
      error: { message: "custom failure", context: ["original"] },
    });
  });

  it("takes one snapshot of a concrete failure's error getter", () => {
    let reads = 0;
    const failure: Parser<string> = () => ({
      success: false,
      get error() {
        return { message: "custom failure", pos: reads++ };
      },
    });
    expect(parse(choice(failure))("abc")).toMatchObject({
      success: false,
      error: { message: "custom failure", pos: 0 },
    });
    expect(reads).toBe(1);
  });
});

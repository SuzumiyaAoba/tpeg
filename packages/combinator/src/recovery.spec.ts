import {
  charClass,
  choice,
  commit,
  createFailure,
  literal,
  notPredicate,
  anyChar,
  parse,
  seq,
  zeroOrMore,
  type ParseError,
} from "@suzumiyaaoba/tpeg-core";
import { expect, test } from "vite-plus/test";
import { recover } from "./recovery";

test("collects several syntax errors and continues parsing valid records", () => {
  const errors: ParseError[] = [];
  const record = recover(seq(charClass(["0", "9"]), literal(";")), {
    synchronize: choice(literal(";"), notPredicate(anyChar())),
    consumeSynchronizer: true,
    fallback: ({ skipped }) => ({ invalid: skipped }),
    onError: (error) => errors.push(error),
  });
  const result = parse(zeroOrMore(record))("1;bad;2;wrong;3;tail");
  expect(result).toMatchObject({
    success: true,
    next: 20,
    val: [
      ["1", ";"],
      { invalid: "bad;" },
      ["2", ";"],
      { invalid: "wrong;" },
      ["3", ";"],
      { invalid: "tail" },
    ],
  });
  expect(errors.map((error) => error.pos)).toEqual([2, 8, 16]);
});

test("can leave a delimiter for its caller, advancing over Unicode code points", () => {
  const offsets: number[] = [];
  const parser = recover(literal("expected"), {
    synchronize: (input, pos) => {
      offsets.push(pos);
      return literal(";")(input, pos);
    },
    fallback: ({ skipped }) => skipped,
  });
  expect(parse(seq(parser, literal(";")))("😀x;")).toMatchObject({
    success: true,
    val: ["😀x", ";"],
    next: 4,
  });
  expect(offsets).toEqual([0, 2, 3]);
  expect(parse(zeroOrMore(parser))(";")).toMatchObject({
    success: true,
    val: [],
    next: 0,
  });
});

test("preserves cut and abort failures and honors the search limit", () => {
  let called = false;
  const options = {
    synchronize: literal(";"),
    fallback: () => {
      called = true;
      return null;
    },
    consumeSynchronizer: true,
  };
  expect(parse(recover(commit(literal("x")), options))("bad;")).toMatchObject({
    success: false,
    error: { fatal: true },
  });
  expect(
    parse(
      recover(
        () => createFailure("limit", 0, { fatal: true, abort: true }),
        options,
      ),
    )("bad;"),
  ).toMatchObject({ success: false, error: { abort: true } });
  expect(called).toBe(false);
  expect(
    parse(recover(literal("x"), { ...options, maxSkip: 2 }))("bad;"),
  ).toMatchObject({ success: false, error: { pos: 0 } });
  expect(called).toBe(false);
  expect(() => recover(literal("x"), { ...options, maxSkip: -1 })).toThrow(
    RangeError,
  );
});

test("a successful recovery does not contribute expectations to a later failure", () => {
  const parser = seq(
    recover(literal("original"), {
      synchronize: literal(";"),
      consumeSynchronizer: true,
      fallback: () => null,
    }),
    literal("after"),
  );
  const result = parse(parser)("bad;no");
  expect(result).toMatchObject({ success: false, error: { pos: 4 } });
  if (!result.success) expect(result.error.expected).not.toContain("original");
});

test("invalid offsets and invalid synchronization positions cannot produce recovery", () => {
  const parser = recover(literal("x"), {
    synchronize: () => ({ success: true, val: null, current: 0, next: -1 }),
    fallback: () => null,
  });
  expect(parser("bad", -1)).toMatchObject({
    success: false,
    error: { abort: true },
  });
  expect(parse(parser)("bad")).toMatchObject({
    success: false,
    error: { abort: true },
  });
});

test("recovery boundaries and reported positions are independent of older abandoned alternatives", () => {
  const errors: ParseError[] = [];
  const record = recover(literal("valid"), {
    synchronize: literal(";"),
    consumeSynchronizer: true,
    fallback: ({ skipped }) => skipped,
    onError: (error) => errors.push(error),
  });
  const parser = choice(literal("bad;z;taix"), seq(literal("bad;"), record));
  expect(parse(parser)("bad;z;tail")).toMatchObject({
    success: true,
    next: 6,
    val: ["bad;", "z;"],
  });
  expect(errors.map((error) => error.pos)).toEqual([4]);
});

test("synchronizer probes absorb their own cuts while preserving resource aborts", () => {
  const parser = recover(literal("valid"), {
    synchronize: seq(literal("a"), commit(literal(";"))),
    consumeSynchronizer: true,
    fallback: ({ skipped }) => skipped,
  });
  expect(parse(parser)("a?ba;")).toMatchObject({
    success: true,
    next: 5,
    val: "a?ba;",
  });
  const abort = recover(literal("valid"), {
    synchronize: () => createFailure("limit", 0, { fatal: true, abort: true }),
    fallback: () => null,
  });
  expect(parse(abort)("bad")).toMatchObject({
    success: false,
    error: { abort: true },
  });
});

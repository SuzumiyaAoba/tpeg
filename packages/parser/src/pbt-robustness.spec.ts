/**
 * Property-based (`fast-check`) robustness tests for the grammar
 * front-end -- see `packages/core/src/pbt-invariants.spec.ts`'s module doc
 * comment for the shared rationale behind this repo's `pbt-*.spec.ts`
 * files.
 *
 * The grammar parser is the entry point for untrusted `.tpeg` text, and
 * most of it is NOT built from the (position-guarded, loop-guarded) core
 * combinators: rule bodies, `{ ... }` action blocks, `//` comments,
 * `transforms` blocks, and the rule-boundary scanner are hand-written
 * direct-input scanners (`grammar.ts`'s `grammarRuleExpression`,
 * `brace-scanner.ts`'s `scanBalancedBraces`, `transforms.ts`'s scanners).
 * Hand-rolled scanners are exactly where a malformed input can desync a
 * scan -- an unterminated `"`, `/*`, `{`, or `[` can make a scanner read
 * to end-of-input, loop without advancing, or report a position outside
 * the input. `grammar.spec.ts` covers a long list of hand-picked
 * malformed cases; this file fuzzes the same contract instead of
 * enumerating it:
 *
 *   For ANY input -- arbitrary binary text, or a valid grammar with
 *   random truncation/insertion/deletion/duplication applied -- every
 *   file-level parser must terminate promptly (no hang; a hang here would
 *   surface as this test's timeout) and return a well-formed result:
 *   success with an integer `next` in `[0, input.length]`, or failure
 *   with an integer `error.pos` in `[0, input.length]`. No result path
 *   may throw -- resource limits surface as `abort` failures, not
 *   exceptions (see `core/src/limits.ts`).
 *
 * A second property runs the same contract over the individual
 * leaf/direct-scanner parsers with ARBITRARY start positions -- negative,
 * fractional, NaN, past-the-end -- since those are the functions a caller
 * can invoke at any offset, and the ones where JS's implicit `slice`/
 * `lastIndex` coercion can silently clamp an invalid position to 0 and
 * produce a success at a position the caller never asked about (the
 * position contract `core/src/utils.ts`'s `isValidOffset` exists to
 * enforce; `core/src/position-contract.spec.ts` pins the same contract
 * with fixed cases).
 */

import { beforeEach, describe, expect, test } from "vite-plus/test";
import fc from "fast-check";
import {
  type ParseResult,
  type Parser,
  isValidOffset,
  resetFailureWatermark,
} from "@suzumiyaaoba/tpeg-core";
import { tpegFile } from "./combined";
import { expression } from "./composition";
import {
  documentationComment,
  grammarDefinition,
  modularGrammarDefinition,
  quotedString,
  ruleDefinition,
  singleLineComment,
  skipTrailingWhitespaceAndComments,
  tpegModuleFile,
} from "./grammar";
import { characterClass } from "./character-class";
import { identifier } from "./identifier";
import { stringLiteral } from "./string-literal";
import { transformDefinition } from "./transforms";

beforeEach(() => {
  resetFailureWatermark();
});

const FUZZ_SCALE = Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1);
const FC_PARAMS = { seed: 20260821, numRuns: 200 * FUZZ_SCALE };

// ---------------------------------------------------------------------------
// Result well-formedness
// ---------------------------------------------------------------------------

/**
 * The contract every parser in this package must satisfy for ANY
 * input/position: a success stops at an integer offset inside the input,
 * a failure reports an integer offset inside the input. Anything else --
 * a thrown exception, a fractional `next`, a position past end-of-input
 * -- is a bug, not a bad input.
 */
const expectWellFormedResult = <T>(
  result: ParseResult<T>,
  input: string,
): void => {
  if (result.success) {
    expect(Number.isInteger(result.next)).toBe(true);
    expect(result.next).toBeGreaterThanOrEqual(0);
    expect(result.next).toBeLessThanOrEqual(input.length);
  } else {
    expect(Number.isInteger(result.error.pos)).toBe(true);
    expect(result.error.pos).toBeGreaterThanOrEqual(0);
    expect(result.error.pos).toBeLessThanOrEqual(input.length);
  }
};

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Arbitrary UTF-16 text, bounded so one parse stays cheap and any nesting
// it happens to contain (~len/2 levels at most) is far below
// MAX_RECURSION_DEPTH = 1000 -- this property tests robustness on
// hostile bytes, not the limit machinery itself (that has its own test
// below).
const textArb = fc.string({ unit: "binary", maxLength: 120 });

// Valid grammar files exercising the desync-prone constructs: string
// literals in both quote styles with escapes, char classes, `{ ... }`
// action bodies containing JS regexes/brackets/strings, labels,
// lookahead, annotations, imports, and a trailing transforms block.
const BASE_GRAMMARS: readonly string[] = [
  `grammar Calc {
  @version: "1.0"
  @start: "expr"
  expr = term ("+" term)*
  term = [0-9]+
}`,
  `grammar G {
  r = "x" { return a / b / c; }
  s = 'y' { return x["]"]; }
  t = label:"z" !"w" .
  u = [a-zA-Z_][a-zA-Z0-9_]* / "\\"" / '\\''
}
transforms T@typescript {
  f(x) -> number { return x.length; }
}`,
  `import "./base.tpeg" as base
grammar M extends base.Base {
  @export: [start]
  start = base.item+
}`,
];

// Characters chosen to maximize the chance of desyncing a scanner:
// every delimiter the grammar uses, escape introducers, comment
// openers/closers, NUL, a lone surrogate pair, and ordinary identifier
// characters.
const HOSTILE_CHARS = [
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  '"',
  "'",
  "\\",
  "/",
  "*",
  "@",
  "=",
  "<",
  ">",
  "-",
  "+",
  "?",
  "!",
  "&",
  "|",
  ":",
  ",",
  ";",
  "#",
  "$",
  "`",
  "~",
  " ",
  "\t",
  "\n",
  "\r",
  "\0",
  "\ufffd",
  "\ud800",
  "\udfff",
  "😀",
  "e",
  "r",
  "u",
  "n",
  "x",
  "0",
  "9",
];

const hostileTextArb = fc.string({
  unit: fc.constantFrom(...HOSTILE_CHARS),
  maxLength: 8,
});

interface Mutation {
  readonly kind: "truncate" | "delete" | "insert" | "duplicate" | "replace";
  readonly at: number;
  readonly span: number;
  readonly text: string;
}

// Apply one mutation, clamping all indices into range so any `at`/`span`
// is legal on any-length source.
const applyMutation = (src: string, m: Mutation): string => {
  const at = src.length === 0 ? 0 : m.at % (src.length + 1);
  switch (m.kind) {
    case "truncate":
      return src.slice(0, at);
    case "delete":
      return (
        src.slice(0, at) + src.slice(Math.min(src.length, at + 1 + m.span))
      );
    case "insert":
      return src.slice(0, at) + m.text + src.slice(at);
    case "duplicate": {
      const span = Math.max(1, m.span % Math.max(1, src.length));
      return src.slice(0, at) + src.slice(at, at + span) + src.slice(at);
    }
    case "replace":
      return (
        src.slice(0, at) +
        m.text +
        src.slice(Math.min(src.length, at + m.text.length))
      );
  }
};

const mutationArb = fc.record({
  kind: fc.constantFrom("truncate", "delete", "insert", "duplicate", "replace"),
  at: fc.nat(),
  span: fc.nat({ max: 24 }),
  text: hostileTextArb,
});

// A valid grammar file with up to 4 random mutations applied -- produces
// near-miss inputs (unterminated strings/comments/braces, cut-off rule
// bodies, spliced-in delimiters) that pure random text almost never
// reaches past the `grammar` keyword.
const mutatedGrammarArb = fc
  .tuple(
    fc.constantFrom(...BASE_GRAMMARS),
    fc.array(mutationArb, { maxLength: 4 }),
  )
  .map(([base, mutations]) => {
    let src = base;
    for (const m of mutations) src = applyMutation(src, m);
    return src;
  });

// ---------------------------------------------------------------------------
// File-level parser robustness
// ---------------------------------------------------------------------------

const FILE_LEVEL_PARSERS: ReadonlyArray<{
  readonly name: string;
  readonly parser: Parser<unknown>;
}> = [
  { name: "grammarDefinition", parser: grammarDefinition },
  { name: "modularGrammarDefinition", parser: modularGrammarDefinition },
  { name: "tpegFile", parser: tpegFile },
  { name: "tpegModuleFile", parser: tpegModuleFile },
];

describe("grammar front-end robustness (fast-check)", () => {
  test("arbitrary binary text: every file-level parser terminates with a well-formed result and never throws", () => {
    fc.assert(
      fc.property(textArb, (input) => {
        for (const { parser } of FILE_LEVEL_PARSERS) {
          expectWellFormedResult(parser(input, 0), input);
        }
      }),
      FC_PARAMS,
    );
  }, 30_000);

  test("mutated valid grammars: every file-level parser terminates with a well-formed result and never throws", () => {
    fc.assert(
      fc.property(mutatedGrammarArb, (input) => {
        for (const { parser } of FILE_LEVEL_PARSERS) {
          expectWellFormedResult(parser(input, 0), input);
        }
      }),
      FC_PARAMS,
    );
  }, 30_000);

  test("rule-level and transform parsers on mutated grammars terminate with well-formed results", () => {
    const parsers: readonly Parser<unknown>[] = [
      ruleDefinition,
      transformDefinition,
    ];
    fc.assert(
      fc.property(mutatedGrammarArb, (input) => {
        for (const parser of parsers) {
          expectWellFormedResult(parser(input, 0), input);
        }
      }),
      FC_PARAMS,
    );
  }, 30_000);

  test("deeply nested group input aborts at the recursion limit instead of overflowing the stack", () => {
    // 1200 nested groups: each `(`-group nests one `lazy` frame of
    // recursion depth, so this trips MAX_RECURSION_DEPTH = 1000 (400 did
    // NOT -- the limit is on in-flight lazy calls, not raw characters).
    // The limit must surface as an `abort` failure -- a returned result,
    // not a thrown RangeError -- so backtracking can't silently swallow
    // it (see core/src/limits.ts).
    const input = `${"(".repeat(1200)}x${")".repeat(1200)}`;
    const result = expression()(input, 0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.abort).toBe(true);
    }
  });

  test("deeply nested input at every file level also aborts rather than throwing", () => {
    const input = `grammar G { r = ${"(".repeat(1200)}x${")".repeat(1200)} }`;
    for (const { parser } of FILE_LEVEL_PARSERS) {
      expectWellFormedResult(parser(input, 0), input);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Leaf/direct-scanner parsers at arbitrary positions
// ---------------------------------------------------------------------------

// Positions a caller can pass: in-range offsets (inputs stay <= 120
// chars, so 0..400 covers in-range, just-past-end, and way-past-end),
// negative offsets, fractional/NaN/Infinity doubles, uint32-boundary
// values, and `-0` (a valid offset, === 0).
const posArb = fc.oneof(
  fc.integer({ min: 0, max: 400 }),
  fc.integer({ min: -100, max: -1 }),
  fc.constantFrom(
    Number.NaN,
    -0.5,
    0.5,
    1.5,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    2 ** 32 - 1,
    2 ** 32,
    -0,
  ),
  fc.double(),
);

// Every parser in this package that reads `input` directly (or leads a
// composite a caller might invoke at a nonzero offset).
const LEAF_PARSERS: ReadonlyArray<{
  readonly name: string;
  readonly parser: Parser<unknown>;
}> = [
  { name: "stringLiteral", parser: stringLiteral },
  { name: "characterClass", parser: characterClass },
  { name: "identifier", parser: identifier },
  { name: "quotedString", parser: quotedString },
  { name: "singleLineComment", parser: singleLineComment },
  { name: "documentationComment", parser: documentationComment },
];

describe("leaf/direct-scanner parsers at arbitrary positions (fast-check)", () => {
  test("never throw, never report an out-of-range position, and only succeed at a valid in-range offset", () => {
    fc.assert(
      fc.property(textArb, posArb, (input, pos) => {
        for (const { parser } of LEAF_PARSERS) {
          const result = parser(input, pos);
          if (result === undefined || result === null) {
            throw new Error("parser returned no result");
          }
          if (result.success) {
            // A success may only ever come from a valid offset inside
            // the input -- an invalid `pos` must fail, never clamp to
            // 0 via slice/lastIndex coercion.
            expect(isValidOffset(pos)).toBe(true);
            expect(pos).toBeLessThanOrEqual(input.length);
            expect(Number.isInteger(result.next)).toBe(true);
            expect(result.next).toBeGreaterThanOrEqual(pos);
            expect(result.next).toBeLessThanOrEqual(input.length);
          } else if (isValidOffset(pos) && pos <= input.length) {
            // From a valid start offset a failure's reported position
            // stays inside the input. (For an invalid start offset
            // the failure echoes the caller's position -- that's the
            // contract, so nothing further is asserted there.)
            expect(Number.isInteger(result.error.pos)).toBe(true);
            expect(result.error.pos).toBeGreaterThanOrEqual(0);
            expect(result.error.pos).toBeLessThanOrEqual(input.length);
          }
        }
      }),
      FC_PARAMS,
    );
  }, 30_000);

  test("raw offset scanners never throw: skipTrailingWhitespaceAndComments returns an in-range offset for valid starts and echoes an invalid start unchanged", () => {
    // `skipTrailingWhitespaceAndComments` is a `(text, start) => number`
    // scanner, not a Parser -- its callers use the return value as
    // `=== text.length` to mean "the rest of the input is whitespace
    // and comments only". For a valid start it must return an integer
    // inside [start, text.length]; for an invalid start it fails closed
    // by returning `start` unchanged, which a `=== length` check
    // correctly rejects as "not fully consumed".
    fc.assert(
      fc.property(textArb, posArb, (input, pos) => {
        const result = skipTrailingWhitespaceAndComments(input, pos);
        if (isValidOffset(pos) && pos <= input.length) {
          expect(Number.isInteger(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(pos);
          expect(result).toBeLessThanOrEqual(input.length);
        } else {
          expect(result).toBe(pos);
        }
      }),
      FC_PARAMS,
    );
  }, 30_000);
});

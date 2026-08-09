/**
 * Table-driven precedence/parsing tests for `composition.ts`'s
 * `expression()`, pinning:
 *
 * - The FIXED precedence bug (postfix repetition now binds tighter than
 *   prefix lookahead -- `!e*` parses as `!(e*)`, matching standard PEG
 *   (Ford, POPL 2004) and every mainstream implementation, instead of the
 *   previous `(!e)*`). See `composition.ts`'s module doc comment.
 * - The FIXED `{,n}`-shaped malformed-quantifier bug (previously silently
 *   swallowed as a semantic action with syntactically-invalid JS as its
 *   body -- see `repetition.ts`'s `withRepetition`).
 * - A handful of pre-existing precedence/rejection rules this suite
 *   didn't previously pin at all (label vs. sequence, cut vs. choice,
 *   character-class edge cases), to lock today's behavior against
 *   accidental future regressions.
 */

import { describe, expect, it } from "bun:test";
import { expression } from "./composition";
import {
  createChoice,
  createLabeledExpression,
  createNegativeLookahead,
  createOptional,
  createPositiveLookahead,
  createQuantified,
  createSequence,
  createStar,
  createStringLiteral,
} from "./types";
import type { Expression } from "./types";

const lit = (s: string) => createStringLiteral(s, '"');

const parseOk = (source: string): Expression => {
  const result = expression()(source, 0);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("unreachable");
  expect(result.next).toBe(source.length);
  return result.val;
};

describe("composition.ts precedence: repetition binds tighter than lookahead", () => {
  const cases: [string, Expression][] = [
    ['!"a"*', createNegativeLookahead(createStar(lit("a")))],
    ['&"a"*', createPositiveLookahead(createStar(lit("a")))],
    ['!"a"+', createNegativeLookahead({ type: "Plus", expression: lit("a") })],
    ['&"a"?', createPositiveLookahead(createOptional(lit("a")))],
    ['!"a"{2}', createNegativeLookahead(createQuantified(lit("a"), 2, 2))],
    ['!"a"{2,4}', createNegativeLookahead(createQuantified(lit("a"), 2, 4))],
    [
      '!"a"{2,}',
      createNegativeLookahead(createQuantified(lit("a"), 2, undefined)),
    ],
    // An explicit group always spells out the OTHER reading.
    [
      '(!"a")*',
      createStar({
        type: "Group",
        expression: createNegativeLookahead(lit("a")),
      }),
    ],
  ];

  for (const [source, expected] of cases) {
    it(`parses ${JSON.stringify(source)}`, () => {
      expect(parseOk(source)).toEqual(expected);
    });
  }
});

describe("composition.ts precedence: label wraps lookahead+repetition", () => {
  it('parses check:&"hello"* as check:(&("hello"*))', () => {
    const expected = createLabeledExpression(
      "check",
      createPositiveLookahead(createStar(lit("hello"))),
    );
    expect(parseOk('check:&"hello"*')).toEqual(expected);
  });

  it('parses x:!"a" as x:(!"a") -- label wraps a bare lookahead too', () => {
    const expected = createLabeledExpression(
      "x",
      createNegativeLookahead(lit("a")),
    );
    expect(parseOk('x:!"a"')).toEqual(expected);
  });
});

describe("composition.ts precedence: sequence/choice unaffected", () => {
  it("gives lookahead higher precedence than sequence juxtaposition", () => {
    const expected = createSequence([
      createPositiveLookahead(lit("a")),
      lit("b"),
    ]);
    expect(parseOk('&"a" "b"')).toEqual(expected);
  });

  it("gives repetition higher precedence than sequence juxtaposition", () => {
    const expected = createSequence([createStar(lit("a")), lit("b")]);
    expect(parseOk('"a"* "b"')).toEqual(expected);
  });

  it("gives sequence higher precedence than choice", () => {
    const expected = createChoice([
      createSequence([lit("a"), lit("b")]),
      lit("c"),
    ]);
    expect(parseOk('"a" "b" / "c"')).toEqual(expected);
  });
});

describe("composition.ts: e{,n} no longer silently misreads as a semantic action", () => {
  // Regression coverage for the bug fixed alongside this test:
  // `"a"{,3}` used to fall through to `withOptionalAction`
  // (`scanBalancedBraces` only checks brace balance, not content), silently
  // compiling to an action whose body was the syntactically-invalid text
  // `,3` -- a `SyntaxError` only once the generated module was actually
  // loaded, with no diagnostic anywhere. Every case here must now fail to
  // parse as a plain expression instead.
  const malformed = ['"a"{,3}', '"a"{}', '"a"{2,3,4}', '"a"{ 2 }', '"a"*{,3}'];

  for (const source of malformed) {
    it(`rejects ${JSON.stringify(source)} instead of misreading it as an action`, () => {
      const result = expression()(source, 0);
      // Either the whole thing fails to parse, or SOME prefix parses but
      // doesn't consume the malformed `{...}` tail as part of the same
      // expression (composition.ts's `expression()` doesn't require
      // consuming the whole input) -- either way, the malformed suffix
      // must never end up silently absorbed as this expression's action.
      if (result.success) {
        expect(result.next).toBeLessThan(source.length);
        expect(result.val.type).not.toBe("ActionExpression");
      }
    });
  }

  it("still accepts a genuine action whose body starts right after the atom (no space)", () => {
    const result = expression()('"a"{return 1;}', 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("ActionExpression");
      expect(result.next).toBe('"a"{return 1;}'.length);
    }
  });

  it("still accepts a genuine action separated from the atom by whitespace", () => {
    const result = expression()('"a" { return 1; }', 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("ActionExpression");
    }
  });

  it("still accepts every valid quantifier form", () => {
    for (const source of ['"a"{2}', '"a"{2,}', '"a"{2,5}']) {
      const result = expression()(source, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("Quantified");
        expect(result.next).toBe(source.length);
      }
    }
  });
});

describe("composition.ts: pre-existing precedence/rejection rules (regression pins)", () => {
  it("rejects a second repetition operator chained onto the first (e{2}{3})", () => {
    const result = expression()('"a"{2}{3}', 0);
    if (result.success) {
      expect(result.next).toBeLessThan('"a"{2}{3}'.length);
    } else {
      expect(result.success).toBe(false);
    }
  });

  it("rejects e** (double star)", () => {
    const result = expression()('"a"**', 0);
    if (result.success) {
      expect(result.next).toBeLessThan('"a"**'.length);
    } else {
      expect(result.success).toBe(false);
    }
  });

  it("parses a cut inside a sequence, scoped to that sequence", () => {
    const result = expression()('"if" ~ "cond" / "else"', 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("Choice");
      if (result.val.type === "Choice") {
        const first = result.val.alternatives[0];
        expect(first?.type).toBe("Sequence");
        if (first?.type === "Sequence") {
          expect(first.elements.map((e) => e.type)).toEqual([
            "StringLiteral",
            "Cut",
            "StringLiteral",
          ]);
        }
      }
    }
  });
});

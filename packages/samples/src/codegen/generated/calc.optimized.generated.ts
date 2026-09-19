import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { memoize } from "@suzumiyaaoba/tpeg-combinator";
import { anyChar, capture, captureSequence, charClassRun, ignore, lazy, literal, map, notPredicate, optional, predictiveChoice, sequence, span, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";
export const top: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), (input, pos) => {
  const __base = (captureSequence(ignore(optional(lazy(() => ws))), capture("e", lazy(() => expression)), ignore(optional(lazy(() => ws))), notPredicate(anyChar()), ignore(optional(lazy(() => ws)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { e } = ($$ ?? {});
 return e; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, ignore(optional(lazy(() => ws)))), ([v]) => v));

export const expression: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), (input, pos) => {
  const __base = (captureSequence(ignore(optional(lazy(() => ws))), capture("left", lazy(() => term)), ignore(optional(lazy(() => ws))), capture("rest", zeroOrMore(captureSequence(ignore(optional(lazy(() => ws))), capture("op", lazy(() => add_op)), ignore(optional(lazy(() => ws))), capture("right", lazy(() => term)), ignore(optional(lazy(() => ws)))))), ignore(optional(lazy(() => ws)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { left, rest } = ($$ ?? {});

    let result = left;
    for (const { op, right } of rest) {
      result = op === "+" ? result + right : result - right;
    }
    return result;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, ignore(optional(lazy(() => ws)))), ([v]) => v));

export const term: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), (input, pos) => {
  const __base = (captureSequence(ignore(optional(lazy(() => ws))), capture("left", lazy(() => factor)), ignore(optional(lazy(() => ws))), capture("rest", zeroOrMore(captureSequence(ignore(optional(lazy(() => ws))), capture("op", lazy(() => mul_op)), ignore(optional(lazy(() => ws))), capture("right", lazy(() => factor)), ignore(optional(lazy(() => ws)))))), ignore(optional(lazy(() => ws)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { left, rest } = ($$ ?? {});

    let result = left;
    for (const { op, right } of rest) {
      result = op === "*" ? result * right : result / right;
    }
    return result;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, ignore(optional(lazy(() => ws)))), ([v]) => v));

export const factor: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), predictiveChoice([[(input, pos) => {
  const __base = (capture("n", lazy(() => number)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { n } = ($$ ?? {});
 return n; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, { ranges: [{ lo: 45, hi: 45 }, { lo: 48, hi: 57 }] }], [(input, pos) => {
  const __base = (captureSequence(ignore(optional(lazy(() => ws))), literal("("), ignore(optional(lazy(() => ws))), capture("e", expression), ignore(optional(lazy(() => ws))), literal(")"), ignore(optional(lazy(() => ws)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { e } = ($$ ?? {});
 return e; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, { ranges: [{ lo: 9, hi: 10 }, { lo: 13, hi: 13 }, { lo: 32, hi: 32 }, { lo: 40, hi: 40 }] }]]), ignore(optional(lazy(() => ws)))), ([v]) => v));

export const number: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("text", span(sequence(optional(literal("-")), charClassRun([["0", "9"]], 1), optional(sequence(literal("."), charClassRun([["0", "9"]], 1)))))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { text } = ($$ ?? {});
 return Number(text); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const add_op: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), predictiveChoice([[literal("+"), { ranges: [{ lo: 43, hi: 43 }] }], [literal("-"), { ranges: [{ lo: 45, hi: 45 }] }]]), ignore(optional(lazy(() => ws)))), ([v]) => v));

export const mul_op: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), predictiveChoice([[literal("*"), { ranges: [{ lo: 42, hi: 42 }] }], [literal("/"), { ranges: [{ lo: 47, hi: 47 }] }]]), ignore(optional(lazy(() => ws)))), ([v]) => v));

export const ws: Parser<any> = memoize(untagCapture(charClassRun([" ", "\t", "\n", "\r"], 1)));

export { top as start };

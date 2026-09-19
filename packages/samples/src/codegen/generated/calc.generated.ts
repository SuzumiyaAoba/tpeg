import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClassRun, choice, ignore, lazy, literal, map, notPredicate, optional, sequence, span, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

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

export const factor: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), choice((input, pos) => {
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
}, (input, pos) => {
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
}), ignore(optional(lazy(() => ws)))), ([v]) => v));

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

export const add_op: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), choice(literal("+"), literal("-")), ignore(optional(lazy(() => ws)))), ([v]) => v));

export const mul_op: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), choice(literal("*"), literal("/")), ignore(optional(lazy(() => ws)))), ([v]) => v));

export const ws: Parser<any> = untagCapture(charClassRun([" ", "\t", "\n", "\r"], 1));

export { top as start };

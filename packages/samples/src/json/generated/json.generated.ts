import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClass, charClassRun, choice, ignore, lazy, literal, map, negatedCharClass, notPredicate, optional, sequence, span, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

export const top: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), (input, pos) => {
  const __base = (captureSequence(ignore(optional(lazy(() => ws))), capture("v", lazy(() => value)), ignore(optional(lazy(() => ws))), notPredicate(anyChar()), ignore(optional(lazy(() => ws)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { v } = ($$ ?? {});
 return v; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, ignore(optional(lazy(() => ws)))), ([v]) => v));

export const value: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), choice((input, pos) => {
  const __base = (literal("null"));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return null; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (literal("true"));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return true; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (literal("false"));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return false; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, lazy(() => string), lazy(() => number), lazy(() => object), lazy(() => array)), ignore(optional(lazy(() => ws)))), ([v]) => v));

export const object: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), (input, pos) => {
  const __base = (captureSequence(ignore(optional(lazy(() => ws))), literal("{"), ignore(optional(lazy(() => ws))), capture("pairs", optional(captureSequence(ignore(optional(lazy(() => ws))), capture("first", lazy(() => member)), ignore(optional(lazy(() => ws))), capture("rest", zeroOrMore(captureSequence(ignore(optional(lazy(() => ws))), literal(","), ignore(optional(lazy(() => ws))), capture("m", lazy(() => member)), ignore(optional(lazy(() => ws)))))), ignore(optional(lazy(() => ws)))))), ignore(optional(lazy(() => ws))), literal("}"), ignore(optional(lazy(() => ws)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { pairs } = ($$ ?? {});

    const obj = {};
    if (pairs !== null) {
      const all = [pairs.first, ...pairs.rest.map((x: { m: [string, unknown] }) => x.m)];
      for (const [k, v] of all) {
        // `obj[k] = v` on "__proto__" would invoke the inherited SETTER
        // (prototype pollution or silent loss). defineProperty makes it
        // an own data property, matching JSON.parse.
        Object.defineProperty(obj, k, {
          value: v,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    return obj;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, ignore(optional(lazy(() => ws)))), ([v]) => v));

export const member: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), (input, pos) => {
  const __base = (captureSequence(ignore(optional(lazy(() => ws))), capture("k", lazy(() => string)), ignore(optional(lazy(() => ws))), literal(":"), ignore(optional(lazy(() => ws))), capture("v", value), ignore(optional(lazy(() => ws)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { k, v } = ($$ ?? {});
 return [k, v]; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, ignore(optional(lazy(() => ws)))), ([v]) => v));

export const array: Parser<any> = untagCapture(map(sequence(ignore(optional(lazy(() => ws))), (input, pos) => {
  const __base = (captureSequence(ignore(optional(lazy(() => ws))), literal("["), ignore(optional(lazy(() => ws))), capture("items", optional(captureSequence(ignore(optional(lazy(() => ws))), capture("first", value), ignore(optional(lazy(() => ws))), capture("rest", zeroOrMore(captureSequence(ignore(optional(lazy(() => ws))), literal(","), ignore(optional(lazy(() => ws))), capture("v", value), ignore(optional(lazy(() => ws)))))), ignore(optional(lazy(() => ws)))))), ignore(optional(lazy(() => ws))), literal("]"), ignore(optional(lazy(() => ws)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = ($$ ?? {});

    if (items === null) return [];
    return [items.first, ...items.rest.map((x: { v: unknown }) => x.v)];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, ignore(optional(lazy(() => ws)))), ([v]) => v));

export const string: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\""), capture("chars", zeroOrMore(choice(lazy(() => unicode_escape), lazy(() => simple_escape), lazy(() => string_char)))), literal("\"")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});

    return chars.join("");
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const unicode_escape: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\u"), capture("h1", lazy(() => hex)), capture("h2", lazy(() => hex)), capture("h3", lazy(() => hex)), capture("h4", lazy(() => hex))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { h1, h2, h3, h4 } = ($$ ?? {});

    return String.fromCharCode(parseInt(h1 + h2 + h3 + h4, 16));
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const simple_escape: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\"), capture("e", charClass("\"", "\\", "/", "b", "f", "n", "r", "t"))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { e } = ($$ ?? {});

    switch (e) {
      case "b": return "\b";
      case "f": return "\f";
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      default: return e;
    }
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const string_char: Parser<any> = untagCapture(negatedCharClass(["\x00", "\x1f"], "\"", "\\"));

export const hex: Parser<any> = untagCapture(charClass(["0", "9"], ["a", "f"], ["A", "F"]));

export const number: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("text", span(sequence(optional(literal("-")), choice(literal("0"), sequence(charClass(["1", "9"]), charClassRun([["0", "9"]], 0))), optional(sequence(literal("."), charClassRun([["0", "9"]], 1))), optional(sequence(charClass("e", "E"), optional(charClass("+", "-")), charClassRun([["0", "9"]], 1)))))));
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

export const ws: Parser<any> = untagCapture(charClassRun([" ", "\t", "\n", "\r"], 1));

export { top as start };

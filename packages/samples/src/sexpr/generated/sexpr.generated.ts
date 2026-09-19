import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClass, charClassRun, choice, lazy, literal, negatedCharClass, notPredicate, oneOrMore, optional, sequence, span, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

export const document: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(lazy(() => s), capture("forms", zeroOrMore((input, pos) => {
  const __base = (captureSequence(capture("e", lazy(() => sexp)), lazy(() => s)));
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
})), notPredicate(anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { forms } = ($$ ?? {});
 return forms; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const sexp: Parser<any> = untagCapture(choice(lazy(() => quoted), lazy(() => list), lazy(() => atom)));

export const quoted: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("'"), capture("e", sexp)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { e } = ($$ ?? {});

    return [{ type: "symbol", name: "quote" }, e];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const list: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("("), lazy(() => s), capture("es", zeroOrMore((input, pos) => {
  const __base = (captureSequence(capture("e", sexp), lazy(() => s)));
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
})), literal(")")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { es } = ($$ ?? {});
 return es; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const atom: Parser<any> = untagCapture(choice(lazy(() => number), lazy(() => string), lazy(() => symbol)));

export const number: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("text", span(sequence(optional(charClass("+", "-")), charClassRun([["0", "9"]], 1), optional(sequence(literal("."), charClassRun([["0", "9"]], 1))), notPredicate(lazy(() => symbol_char))))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { text } = ($$ ?? {});

    return { type: "number", value: Number(text) };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const string: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\""), capture("chars", zeroOrMore(choice(lazy(() => unicode_escape), lazy(() => escape), negatedCharClass("\"", "\\")))), literal("\"")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});

    return { type: "string", value: chars.join("") };
  
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

export const escape: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\"), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});

    switch (c) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "b": return "\b";
      case "f": return "\f";
      default: return c;
    }
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const hex: Parser<any> = untagCapture(charClass(["0", "9"], ["a", "f"], ["A", "F"]));

export const symbol: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("name", span(oneOrMore(lazy(() => symbol_char)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name } = ($$ ?? {});

    return { type: "symbol", name };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const symbol_char: Parser<any> = untagCapture(negatedCharClass("(", ")", "\"", ";", "'", " ", "\t", "\n", "\r"));

export const s: Parser<any> = untagCapture(zeroOrMore(choice(charClass(" ", "\t", "\n", "\r"), sequence(literal(";"), charClassRun(["\r", "\n"], 0, true)))));

export { document as start };

import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClass, charClassRun, choice, lazy, literal, notPredicate, optional, sequence, span, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

export const document: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("lines", zeroOrMore(lazy(() => line))), notPredicate(anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { lines } = ($$ ?? {});
 return lines; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const line: Parser<any> = untagCapture(choice(lazy(() => section), lazy(() => pair), lazy(() => blank)));

export const section: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("["), capture("name", span(charClassRun(["]", "\r", "\n"], 0, true))), literal("]"), lazy(() => hws), optional(lazy(() => comment)), lazy(() => line_end)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name } = ($$ ?? {});

    return { type: "section", name: name.trim() };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const pair: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("key", lazy(() => key_text)), lazy(() => hws), literal("="), lazy(() => hws), capture("value", lazy(() => value_text)), lazy(() => hws), optional(lazy(() => comment)), lazy(() => line_end)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key, value } = ($$ ?? {});

    return { type: "pair", key, value };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const key_text: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("text", span(charClassRun(["=", "\r", "\n"], 1, true))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { text } = ($$ ?? {});
 return text.trim(); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const value_text: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("text", span(zeroOrMore(sequence(notPredicate(choice(literal("\r\n"), literal("\n"), literal("\r"), sequence(charClassRun([" ", "\t"], 1), charClass(";", "#")))), anyChar())))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { text } = ($$ ?? {});

    return text.trim();
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const blank: Parser<any> = untagCapture(choice((input, pos) => {
  const __base = (sequence(lazy(() => hws), optional(lazy(() => comment)), lazy(() => eol)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return { type: "blank" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (sequence(lazy(() => hws), lazy(() => comment), notPredicate(anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return { type: "blank" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (sequence(charClassRun([" ", "\t"], 1), notPredicate(anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return { type: "blank" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}));

export const comment: Parser<any> = untagCapture(sequence(charClass(";", "#"), charClassRun(["\r", "\n"], 0, true)));

export const hws: Parser<any> = untagCapture(charClassRun([" ", "\t"], 0));

export const line_end: Parser<any> = untagCapture(choice(lazy(() => eol), notPredicate(anyChar())));

export const eol: Parser<any> = untagCapture(choice(literal("\r\n"), literal("\n"), literal("\r")));

export { document as start };

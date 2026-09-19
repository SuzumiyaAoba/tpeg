import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClassRun, choice, lazy, literal, negatedCharClass, notPredicate, span, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

export const document: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("first", lazy(() => row)), capture("rest", zeroOrMore(captureSequence(lazy(() => newline), capture("r", lazy(() => row))))), notPredicate(anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = ($$ ?? {});

    return [first, ...rest.map((x: { r: string[] }) => x.r)];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const row: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("head", lazy(() => field)), capture("tail", zeroOrMore(captureSequence(literal(","), capture("f", lazy(() => field)))))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { head, tail } = ($$ ?? {});

    return [head, ...tail.map((x: { f: string }) => x.f)];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const field: Parser<any> = untagCapture(choice(lazy(() => quoted), lazy(() => unquoted)));

export const quoted: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\""), capture("chars", zeroOrMore(choice(lazy(() => escaped_quote), negatedCharClass("\"")))), literal("\"")));
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

export const escaped_quote: Parser<any> = untagCapture((input, pos) => {
  const __base = (literal("\"\""));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return "\""; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const unquoted: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("text", span(charClassRun([",", "\r", "\n", "\""], 0, true))));
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

export const newline: Parser<any> = untagCapture(choice(literal("\r\n"), literal("\n"), literal("\r")));

export { document as start };

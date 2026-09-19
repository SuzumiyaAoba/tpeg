import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClass, charClassRun, choice, commit, lazy, literal, notPredicate, optional, sequence, span, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

export const url: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("s", lazy(() => scheme)), literal(":"), capture("rest", choice((input, pos) => {
  const __base = (captureSequence(literal("//"), commit(capture("a", lazy(() => authority))), commit(capture("p", optional(lazy(() => path_tail))))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { a, p } = ($$ ?? {});

                return { auth: a, path: p === null ? "" : p };
              
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("opaque", span(charClassRun(["?", "#"], 0, true))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { opaque } = ($$ ?? {});

                return { auth: null, path: opaque };
              
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
})), capture("q", optional(lazy(() => query))), capture("f", optional(lazy(() => fragment))), notPredicate(anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { s, rest, q, f } = ($$ ?? {});

    const parts: Record<string, unknown> = { scheme: s, path: rest.path };
    if (rest.auth !== null) Object.assign(parts, rest.auth);
    if (q !== null) parts["query"] = q;
    if (f !== null) parts["fragment"] = f;
    return parts;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const scheme: Parser<any> = untagCapture(span(sequence(charClass(["a", "z"], ["A", "Z"]), charClassRun([["a", "z"], ["A", "Z"], ["0", "9"], "+", "-", "."], 0))));

export const authority: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("i", optional((input, pos) => {
  const __base = (captureSequence(capture("u", lazy(() => userinfo)), literal("@")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { u } = ($$ ?? {});
 return u; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
})), capture("h", lazy(() => host)), capture("p", optional((input, pos) => {
  const __base = (captureSequence(literal(":"), capture("n", lazy(() => port))));
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
}))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { i, h, p } = ($$ ?? {});

    const auth: Record<string, unknown> = { host: h };
    if (i !== null) auth["userinfo"] = i;
    if (p !== null) auth["port"] = p;
    return auth;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const userinfo: Parser<any> = untagCapture(span(charClassRun(["@", "/", "?", "#", " ", "\t", "\r", "\n"], 1, true)));

export const host: Parser<any> = untagCapture(span(charClassRun([":", "/", "?", "#", "@", " ", "\t", "\r", "\n"], 1, true)));

export const port: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("t", span(charClassRun([["0", "9"]], 1))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { t } = ($$ ?? {});
 return Number(t); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const path_tail: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("/"), capture("t", span(charClassRun(["?", "#"], 0, true)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { t } = ($$ ?? {});
 return "/" + t; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const query: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("?"), capture("t", span(charClassRun(["#"], 0, true)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { t } = ($$ ?? {});
 return t; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const fragment: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("#"), capture("t", span(zeroOrMore(anyChar())))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { t } = ($$ ?? {});
 return t; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export { url as start };

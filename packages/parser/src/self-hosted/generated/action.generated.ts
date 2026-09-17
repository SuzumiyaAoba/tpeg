import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClass, charClassRun, choice, lazy, literal, negatedCharClass, notPredicate, optional, sequence, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

export const escapedActionChar: Parser<any> = untagCapture((input, pos) => {
  const __base = (sequence(literal("\\"), anyChar()));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
 return "\\" + $$[1]; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const doubleQuotedActionString: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\""), capture("chars", zeroOrMore(choice(escapedActionChar, negatedCharClass("\"", "\\")))), literal("\"")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return '"' + chars.join("") + '"'; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const singleQuotedActionString: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("'"), capture("chars", zeroOrMore(choice(escapedActionChar, negatedCharClass("'", "\\")))), literal("'")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return "'" + chars.join("") + "'"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const templateInterp: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("${"), capture("first", optional(captureSequence(capture("w", lazy(() => wsAndComments)), capture("re", lazy(() => actionRegexLiteral))))), capture("parts", zeroOrMore(lazy(() => actionContent))), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, parts } = ($$ ?? {});

    return "${" + (first.length ? first[0].w.join("") + first[0].re : "") + parts.join("") + "}";
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const templatePlainChar: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal("`"), literal("\\"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const templateActionString: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("`"), capture("chars", zeroOrMore(choice(escapedActionChar, templateInterp, templatePlainChar))), literal("`")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return "`" + chars.join("") + "`"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionString: Parser<any> = untagCapture(choice(doubleQuotedActionString, singleQuotedActionString, templateActionString));

export const lineCommentChar: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal("\n"), literal("\r"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const blockCommentChar: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(notPredicate(literal("*/")), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionLineComment: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("//"), capture("chars", zeroOrMore(lineCommentChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return "//" + chars.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionBlockComment: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("/*"), capture("chars", zeroOrMore(blockCommentChar)), literal("*/")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return "/*" + chars.join("") + "*/"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const wsAndComments: Parser<any> = untagCapture(zeroOrMore(choice(charClass(" ", "\t", "\n", "\r"), actionLineComment, actionBlockComment)));

export const actionRegexEscaped: Parser<any> = untagCapture((input, pos) => {
  const __base = (sequence(literal("\\"), anyChar()));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
 return "\\" + $$[1]; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionRegexClassChar: Parser<any> = untagCapture(choice(actionRegexEscaped, (input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal("]"), literal("\n"), literal("\r"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}));

export const actionRegexClass: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("["), capture("chars", zeroOrMore(actionRegexClassChar)), literal("]")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return "[" + chars.join("") + "]"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionRegexBodyChar: Parser<any> = untagCapture(choice(actionRegexEscaped, actionRegexClass, (input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal("/"), literal("["), literal("\n"), literal("\r"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}));

export const actionRegexLiteral: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("/"), notPredicate(choice(literal("/"), literal("*"))), capture("body", zeroOrMore(actionRegexBodyChar)), literal("/"), capture("flags", charClassRun([["a", "z"]], 0))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { body, flags } = ($$ ?? {});
 return "/" + body.join("") + "/" + flags.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionRegexKeyword: Parser<any> = untagCapture(choice(literal("instanceof"), literal("await"), literal("case"), literal("default"), literal("delete"), literal("do"), literal("else"), literal("in"), literal("new"), literal("of"), literal("return"), literal("throw"), literal("typeof"), literal("void"), literal("yield")));

export const actionOpChar: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal(")"), literal("]"), literal("{"), literal("}"), literal("\""), literal("'"), literal("`"), literal("/"), charClass(["A", "Z"], ["a", "z"], ["0", "9"], "_", "$"), charClass(" ", "\t", "\n", "\r"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionPostfix: Parser<any> = untagCapture(choice(literal("++"), literal("--")));

export const actionKwRegex: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("kw", actionRegexKeyword), notPredicate(charClass(["A", "Z"], ["a", "z"], ["0", "9"], "_", "$")), capture("w", wsAndComments), capture("re", actionRegexLiteral)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { kw, w, re } = ($$ ?? {});
 return kw + w.join("") + re; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionOpRegex: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("op", actionOpChar), capture("w", wsAndComments), capture("re", actionRegexLiteral)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { op, w, re } = ($$ ?? {});
 return op + w.join("") + re; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionParenPlainChar: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal("{"), literal("}"), literal("("), literal(")"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionParenItem: Parser<any> = untagCapture(choice(lazy(() => nestedActionBlock), actionString, actionLineComment, actionBlockComment, actionPostfix, actionKwRegex, actionOpRegex, lazy(() => actionStmtParenRegex), lazy(() => actionParenGroup), lazy(() => actionIdentifier), actionParenPlainChar));

export const actionParenGroup: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("("), capture("first", optional(captureSequence(capture("w", wsAndComments), capture("re", actionRegexLiteral)))), capture("parts", zeroOrMore(actionParenItem)), literal(")")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, parts } = ($$ ?? {});

    return "(" + (first.length ? first[0].w.join("") + first[0].re : "") + parts.join("") + ")";
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionStmtParenKeyword: Parser<any> = untagCapture(choice(literal("catch"), literal("switch"), literal("while"), literal("with"), literal("for"), literal("if")));

export const actionStmtParenRegex: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("kw", actionStmtParenKeyword), notPredicate(charClass(["A", "Z"], ["a", "z"], ["0", "9"], "_", "$")), capture("w1", wsAndComments), capture("g", actionParenGroup), capture("w2", wsAndComments), capture("re", actionRegexLiteral)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { kw, w1, g, w2, re } = ($$ ?? {});

    return kw + w1.join("") + g + w2.join("") + re;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const nestedActionBlock: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("inner", lazy(() => actionBlock)), capture("tail", optional(captureSequence(capture("w", wsAndComments), capture("re", actionRegexLiteral))))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { inner, tail } = ($$ ?? {});
 return "{" + inner + "}" + (tail.length ? tail[0].w.join("") + tail[0].re : ""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionIdentifier: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("h", charClass(["A", "Z"], ["a", "z"], "_", "$")), capture("t", charClassRun([["A", "Z"], ["a", "z"], ["0", "9"], "_", "$"], 0))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { h, t } = ($$ ?? {});
 return h + t.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionPlainChar: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal("{"), literal("}"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const actionContent: Parser<any> = untagCapture(choice(nestedActionBlock, actionString, actionLineComment, actionBlockComment, actionPostfix, actionKwRegex, actionOpRegex, actionStmtParenRegex, actionIdentifier, actionPlainChar));

export const actionBlock: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("{"), capture("first", optional(captureSequence(capture("w", wsAndComments), capture("re", actionRegexLiteral)))), capture("parts", zeroOrMore(actionContent)), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, parts } = ($$ ?? {});
 return (first.length ? first[0].w.join("") + first[0].re : "") + parts.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});
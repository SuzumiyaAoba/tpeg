import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClass, charClassRun, choice, commit, lazy, literal, negatedCharClass, notPredicate, oneOrMore, optional, sequence, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

export const escapeChar: Parser<any> = untagCapture(sequence(literal("\\"), charClass("n", "r", "t", "\\", "\"", "'")));

export const doubleStringChar: Parser<any> = untagCapture(choice((input, pos) => {
  const __base = (escapeChar);
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
 const c = $$[1]; if (c === "n") return "\n"; if (c === "r") return "\r"; if (c === "t") return "\t"; return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, negatedCharClass("\"", "\\")));

export const singleStringChar: Parser<any> = untagCapture(choice((input, pos) => {
  const __base = (escapeChar);
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
 const c = $$[1]; if (c === "n") return "\n"; if (c === "r") return "\r"; if (c === "t") return "\t"; return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, negatedCharClass("'", "\\")));

export const doubleQuotedString: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\""), capture("chars", zeroOrMore(doubleStringChar)), literal("\"")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return { type: "StringLiteral", value: chars.join(""), quote: '"' }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const singleQuotedString: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("'"), capture("chars", zeroOrMore(singleStringChar)), literal("'")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return { type: "StringLiteral", value: chars.join(""), quote: "'" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const stringLiteralNode: Parser<any> = untagCapture(choice(doubleQuotedString, singleQuotedString));

export const classEscapeStd: Parser<any> = untagCapture((input, pos) => {
  const __base = (sequence(literal("\\"), charClass("t", "n", "r", "b", "f", "v", "0")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
 const c = $$[1]; if (c === "t") return "\t"; if (c === "n") return "\n"; if (c === "r") return "\r"; if (c === "b") return "\b"; if (c === "f") return "\f"; if (c === "v") return "\v"; return "\0"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const classEscapeSpecial: Parser<any> = untagCapture((input, pos) => {
  const __base = (sequence(literal("\\"), charClass("]", "\\", "^", "-", "\"", "'")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
 return $$[1]; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const classChar: Parser<any> = untagCapture(choice(classEscapeStd, classEscapeSpecial, negatedCharClass("]", "\\", "^", "-")));

export const charRangePair: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("start", classChar), literal("-"), capture("end", classChar)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { start, end } = ($$ ?? {});

    if ((start.codePointAt(0) ?? 0) > (end.codePointAt(0) ?? 0)) {
      throw new Error("Invalid character range: \"" + start + "-" + end + "\" (start must not be greater than end)");
    }
    return { start, end };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const charRangeSingle: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("start", classChar));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { start } = ($$ ?? {});
 return { start }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const charRange: Parser<any> = untagCapture(choice(charRangePair, charRangeSingle));

export const characterClassBrackets: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("["), capture("negation", optional(literal("^"))), capture("ranges", oneOrMore(charRange)), literal("]")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { negation, ranges } = ($$ ?? {});
 return { type: "CharacterClass", ranges, negated: negation.length > 0 }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const anyCharDot: Parser<any> = untagCapture((input, pos) => {
  const __base = (literal("."));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return { type: "AnyChar" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const characterClassNode: Parser<any> = untagCapture(choice(characterClassBrackets, anyCharDot));

export const identStart: Parser<any> = untagCapture(charClass(["a", "z"], ["A", "Z"], "_"));

export const identContChar: Parser<any> = untagCapture(charClass(["a", "z"], ["A", "Z"], ["0", "9"], "_"));

export const identCont: Parser<any> = untagCapture(zeroOrMore(identContChar));

export const identifierName: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("start", identStart), capture("rest", identCont)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { start, rest } = ($$ ?? {});
 return start + rest.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const identifierNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("name", identifierName));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name } = ($$ ?? {});
 return { type: "Identifier", name }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const qualifiedIdentifierNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("module", identifierName), literal("."), capture("name", identifierName), commit(notPredicate(sequence(literal("."), identStart)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { module, name } = ($$ ?? {});
 return { type: "QualifiedIdentifier", module, name }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const basicSyntax: Parser<any> = untagCapture(choice(stringLiteralNode, characterClassNode, qualifiedIdentifierNode, identifierNode));

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

export const actionStringLiteral: Parser<any> = untagCapture(choice(doubleQuotedActionString, singleQuotedActionString, templateActionString));

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
  const __base = (captureSequence(capture("kw", actionRegexKeyword), notPredicate(charClass(["A", "Z"], ["a", "z"], ["0", "9"], "_", "$")), capture("w", lazy(() => wsAndComments)), capture("re", actionRegexLiteral)));
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
  const __base = (captureSequence(capture("op", actionOpChar), capture("w", lazy(() => wsAndComments)), capture("re", actionRegexLiteral)));
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

export const actionParenItem: Parser<any> = untagCapture(choice(lazy(() => nestedActionBlock), actionStringLiteral, actionLineComment, actionBlockComment, actionPostfix, actionKwRegex, actionOpRegex, lazy(() => actionStmtParenRegex), lazy(() => actionParenGroup), lazy(() => actionIdentifier), actionParenPlainChar));

export const actionParenGroup: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("("), capture("first", optional(captureSequence(capture("w", lazy(() => wsAndComments)), capture("re", actionRegexLiteral)))), capture("parts", zeroOrMore(actionParenItem)), literal(")")));
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
  const __base = (captureSequence(capture("kw", actionStmtParenKeyword), notPredicate(charClass(["A", "Z"], ["a", "z"], ["0", "9"], "_", "$")), capture("w1", lazy(() => wsAndComments)), capture("g", actionParenGroup), capture("w2", lazy(() => wsAndComments)), capture("re", actionRegexLiteral)));
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
  const __base = (captureSequence(capture("inner", lazy(() => actionBlock)), capture("tail", optional(captureSequence(capture("w", lazy(() => wsAndComments)), capture("re", actionRegexLiteral))))));
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

export const actionContent: Parser<any> = untagCapture(choice(nestedActionBlock, actionStringLiteral, actionLineComment, actionBlockComment, actionPostfix, actionKwRegex, actionOpRegex, actionStmtParenRegex, actionIdentifier, actionPlainChar));

export const actionBlock: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("{"), capture("first", optional(captureSequence(capture("w", lazy(() => wsAndComments)), capture("re", actionRegexLiteral)))), capture("parts", zeroOrMore(actionContent)), literal("}")));
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

export const interWs: Parser<any> = untagCapture(charClassRun([" ", "\t", "\n", "\r"], 0));

export const interWsPlus: Parser<any> = untagCapture(charClassRun([" ", "\t", "\n", "\r"], 1));

export const wsAndComments: Parser<any> = untagCapture(zeroOrMore(choice(charClass(" ", "\t", "\n", "\r"), actionLineComment, actionBlockComment)));

export const docCommentRaw: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("///"), capture("chars", zeroOrMore(lineCommentChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return { doc: chars.join("").trim() }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const wsAndCommentsOrDocs: Parser<any> = untagCapture(zeroOrMore(choice(charClass(" ", "\t", "\n", "\r"), docCommentRaw, actionLineComment, actionBlockComment)));

export const wsAndCommentsPlus: Parser<any> = untagCapture(oneOrMore(choice(charClass(" ", "\t", "\n", "\r"), actionLineComment, actionBlockComment)));

export const group: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("("), wsAndComments, capture("expr", lazy(() => choiceExpr)), wsAndComments, literal(")")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = ($$ ?? {});
 return { type: "Group", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const primary: Parser<any> = untagCapture(choice(group, basicSyntax));

export const integer: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("digits", charClassRun([["0", "9"]], 1)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { digits } = ($$ ?? {});

    const text = digits.join("");
    const n = parseInt(text, 10);
    if (!Number.isSafeInteger(n)) {
      throw new Error("Invalid quantifier bound: {" + text + "} is not a safe integer");
    }
    return n;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const quantifiedRange: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("{"), capture("min", integer), literal(","), capture("max", integer), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { min, max } = ($$ ?? {});

    if (min > max) {
      throw new Error("Invalid quantifier range: {" + min + "," + max + "} (minimum must not be greater than maximum)");
    }
    return { min, max };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const quantifiedMin: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("{"), capture("min", integer), literal(","), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { min } = ($$ ?? {});
 return { min, max: undefined }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const quantifiedExact: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("{"), capture("n", integer), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { n } = ($$ ?? {});
 return { min: n, max: n }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const quantifiedOp: Parser<any> = untagCapture(choice(quantifiedRange, quantifiedMin, quantifiedExact));

export const starOp: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("expr", primary), literal("*")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = ($$ ?? {});
 return { type: "Star", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const plusOp: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("expr", primary), literal("+")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = ($$ ?? {});
 return { type: "Plus", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const optionalOp: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("expr", primary), literal("?")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = ($$ ?? {});
 return { type: "Optional", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const quantOp: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("expr", primary), capture("q", quantifiedOp)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr, q } = ($$ ?? {});
 return { type: "Quantified", expression: expr, min: q.min, max: q.max }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const quantifierSuffix: Parser<any> = untagCapture(sequence(literal("{"), charClassRun([["0", "9"]], 1), optional(sequence(literal(","), charClassRun([["0", "9"]], 0))), literal("}")));

export const adjacentMalformedQuantifier: Parser<any> = untagCapture(sequence(literal("{"), charClassRun([["0", "9"], ",", " ", "\t", "\n", "\r", "\v", "\f"], 0), literal("}")));

export const postfix: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("expr", choice(starOp, plusOp, optionalOp, quantOp, primary)), notPredicate(choice(literal("*"), literal("+"), literal("?"), quantifierSuffix)), notPredicate(adjacentMalformedQuantifier)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = ($$ ?? {});

    return expr;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const positiveLookahead: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("&"), capture("expr", postfix)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = ($$ ?? {});
 return { type: "PositiveLookahead", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const negativeLookahead: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("!"), capture("expr", postfix)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = ($$ ?? {});
 return { type: "NegativeLookahead", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const prefix: Parser<any> = untagCapture(choice(positiveLookahead, negativeLookahead, postfix));

export const labeled: Parser<any> = untagCapture(choice((input, pos) => {
  const __base = (captureSequence(capture("label", identifierName), literal(":"), capture("expr", prefix)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { label, expr } = ($$ ?? {});
 return { type: "LabeledExpression", label, expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, prefix));

export const notNextRuleStart: Parser<any> = untagCapture(sequence(notPredicate(sequence(identifierName, wsAndComments, literal("="))), notPredicate(sequence(literal("transforms"), notPredicate(identContChar)))));

export const cutMarkerNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (literal("~"));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return { type: "Cut" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const sequenceElementNode: Parser<any> = untagCapture(choice(cutMarkerNode, labeled));

export const sequenceContinuation: Parser<any> = untagCapture(sequence(wsAndComments, notNextRuleStart, sequenceElementNode));

export const sequenceBase: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("first", sequenceElementNode), capture("rest", zeroOrMore(sequenceContinuation))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = ($$ ?? {});

    if (rest.length === 0) return first;
    const elements = [first, ...rest.map((r: any) => r[2])];
    return { type: "Sequence", elements };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const alternative: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("base", sequenceBase), capture("act", optional(captureSequence(wsAndComments, capture("code", actionBlock))))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { base, act } = ($$ ?? {});

    if (act.length === 0) return base;
    const code = act[0].code;
    if (/^\d+(,\d*)?$/.test(code.trim())) {
      throw new Error("Ambiguous \"{" + code + "}\" after an expression: this is a quantifier only when written with no space before \"{\"");
    }
    return { type: "ActionExpression", expression: base, code };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const choiceExpr: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("first", alternative), capture("rest", zeroOrMore(sequence(wsAndComments, literal("/"), wsAndComments, alternative)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = ($$ ?? {});

    if (rest.length === 0) return first;
    const alternatives = [first, ...rest.map((r: any) => r[3])];
    return { type: "Choice", alternatives };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const ruleDefinitionNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(interWs, capture("name", identifierName), wsAndComments, literal("="), wsAndComments, capture("pattern", choiceExpr)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, pattern } = ($$ ?? {});

    return { type: "RuleDefinition", name, pattern };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const annotationValue: Parser<any> = untagCapture(choice(lazy(() => quotedStringValue), identifierName));

export const dedicatedAnnotationKey: Parser<any> = untagCapture(sequence(choice(literal("export"), literal("dependencies"), literal("conflicts"), literal("requires"), literal("memoize")), notPredicate(identContChar)));

export const keyValueAnnotation: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(interWs, literal("@"), notPredicate(dedicatedAnnotationKey), capture("key", identifierName), interWs, literal(":"), interWs, capture("value", annotationValue)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key, value } = ($$ ?? {});

    return { type: "GrammarAnnotation", key, value };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const flagAnnotation: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(interWs, literal("@"), notPredicate(dedicatedAnnotationKey), capture("key", identifierName)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key } = ($$ ?? {});

    return { type: "GrammarAnnotation", key, value: "" };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const grammarAnnotationNode: Parser<any> = untagCapture(choice(keyValueAnnotation, flagAnnotation));

export const memoizeAnnotationNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(interWs, literal("@"), literal("memoize"), capture("v", optional(captureSequence(wsAndComments, literal(":"), wsAndComments, capture("digits", charClassRun([["0", "9"]], 1)))))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { v } = ($$ ?? {});

    return { type: "GrammarAnnotation", key: "memoize", value: v.length ? v[0].digits.join("") : "" };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const annotatedRuleNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("anns", oneOrMore(memoizeAnnotationNode)), wsAndComments, capture("r", ruleDefinitionNode)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { anns, r } = ($$ ?? {});

    return { ...r, annotations: anns };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const singleLineCommentNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("//"), capture("chars", zeroOrMore(lineCommentChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return { kind: "comment" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const docCommentNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("///"), capture("chars", zeroOrMore(lineCommentChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = ($$ ?? {});
 return { kind: "documentation", value: chars.join("").trim() }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const blockCommentNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("/*"), capture("chars", zeroOrMore(blockCommentChar)), literal("*/")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return { kind: "comment" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const leadingContentUnit: Parser<any> = untagCapture(choice(blockCommentNode, docCommentNode, singleLineCommentNode, interWsPlus));

export const leadingContent: Parser<any> = untagCapture(zeroOrMore(leadingContentUnit));

export const quotedStringValue: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("s", stringLiteralNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { s } = ($$ ?? {});
 return s.value; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const importAlias: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(wsAndCommentsPlus, literal("as"), wsAndCommentsPlus, capture("name", identifierName)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name } = ($$ ?? {});
 return name; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const identifierCommaList: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("first", identifierName), capture("rest", zeroOrMore(sequence(wsAndComments, literal(","), wsAndComments, identifierName)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = ($$ ?? {});

    return [first, ...rest.map((r: any) => r[3])];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const selectiveImportList: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("{"), wsAndComments, capture("items", optional(identifierCommaList)), wsAndComments, literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = ($$ ?? {});

    return items.length === 0 ? [] : items[0];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const simpleImportNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("import"), wsAndCommentsPlus, capture("path", quotedStringValue), capture("alias", optional(importAlias))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { path, alias } = ($$ ?? {});

    return { type: "ImportStatement", modulePath: path, alias: alias[0] };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const selectiveImportNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("import"), wsAndCommentsPlus, capture("path", quotedStringValue), wsAndCommentsPlus, capture("selective", selectiveImportList)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { path, selective } = ($$ ?? {});

    return { type: "ImportStatement", modulePath: path, selective };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const versionedImportNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("import"), wsAndCommentsPlus, capture("path", quotedStringValue), wsAndCommentsPlus, literal("version"), wsAndCommentsPlus, capture("version", quotedStringValue), capture("alias", optional(importAlias))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { path, version, alias } = ($$ ?? {});

    return { type: "ImportStatement", modulePath: path, alias: alias[0], version };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const importStatementNode: Parser<any> = untagCapture(choice(versionedImportNode, selectiveImportNode, simpleImportNode));

export const exportRuleList: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("["), wsAndComments, capture("items", optional(identifierCommaList)), wsAndComments, literal("]")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = ($$ ?? {});

    return items.length === 0 ? [] : items[0];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const exportDeclarationNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(interWs, literal("@export"), notPredicate(identContChar), commit(wsAndComments), commit(literal(":")), commit(wsAndComments), commit(capture("rules", exportRuleList))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { rules } = ($$ ?? {});

    return { type: "ExportDeclaration", rules };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const quotedStringList: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("["), wsAndComments, capture("items", optional(sequence(stringLiteralNode, zeroOrMore(sequence(wsAndComments, literal(","), wsAndComments, stringLiteralNode))))), wsAndComments, literal("]")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = ($$ ?? {});

    if (items.length === 0) return [];
    const [first, rest] = items[0];
    return [first.value, ...rest.map((r: any) => r[3].value)];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const moduleInfoListAnnotationNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(interWs, literal("@"), notPredicate(sequence(choice(literal("export"), literal("requires"), literal("memoize")), notPredicate(identContChar))), capture("key", identifierName), wsAndComments, literal(":"), wsAndComments, capture("values", quotedStringList)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key, values } = ($$ ?? {});

    return { type: "ModuleInfoListAnnotation", key, values };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const quotedStringRecordEntry: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("key", stringLiteralNode), wsAndComments, literal(":"), wsAndComments, capture("value", stringLiteralNode)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key, value } = ($$ ?? {});
 return [key.value, value.value]; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const quotedStringRecord: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("{"), wsAndComments, capture("items", optional(sequence(quotedStringRecordEntry, zeroOrMore(sequence(wsAndComments, literal(","), wsAndComments, quotedStringRecordEntry))))), wsAndComments, literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = ($$ ?? {});

    if (items.length === 0) return {};
    const [first, rest] = items[0];
    return Object.fromEntries([first, ...rest.map((r: any) => r[3])]);
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const moduleInfoRecordAnnotationNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(interWs, literal("@"), notPredicate(sequence(choice(literal("export"), literal("dependencies"), literal("conflicts"), literal("memoize")), notPredicate(identContChar))), capture("key", identifierName), wsAndComments, literal(":"), wsAndComments, capture("values", quotedStringRecord)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key, values } = ($$ ?? {});

    return { type: "ModuleInfoRecordAnnotation", key, values };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const dottedGrammarName: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("first", identifierName), capture("rest", zeroOrMore(sequence(literal("."), identifierName)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = ($$ ?? {});

    return [first, ...rest.map((r: any) => r[1])].join(".");
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const grammarExtendsClause: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("extends"), wsAndCommentsPlus, capture("name", dottedGrammarName)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name } = ($$ ?? {});
 return name; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const grammarIncludesClause: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("includes"), wsAndCommentsPlus, capture("first", dottedGrammarName), capture("rest", zeroOrMore(sequence(wsAndComments, literal(","), wsAndComments, dottedGrammarName)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = ($$ ?? {});

    return [first, ...rest.map((r: any) => r[3])];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const targetLanguageNode: Parser<any> = untagCapture(choice((input, pos) => {
  const __base = (captureSequence(capture("lang", literal("typescript")), notPredicate(lazy(() => langChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { lang } = ($$ ?? {});
 return lang; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (captureSequence(capture("lang", literal("python")), notPredicate(lazy(() => langChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { lang } = ($$ ?? {});
 return lang; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (captureSequence(capture("lang", literal("go")), notPredicate(lazy(() => langChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { lang } = ($$ ?? {});
 return lang; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (captureSequence(capture("lang", literal("rust")), notPredicate(lazy(() => langChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { lang } = ($$ ?? {});
 return lang; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (captureSequence(capture("lang", literal("java")), notPredicate(lazy(() => langChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { lang } = ($$ ?? {});
 return lang; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (captureSequence(capture("lang", literal("cpp")), notPredicate(lazy(() => langChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { lang } = ($$ ?? {});
 return lang; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}));

export const langChar: Parser<any> = untagCapture(charClass(["a", "z"], ["A", "Z"], ["0", "9"]));

export const transformSetName: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("name", identifierName), wsAndComments, literal("@"), wsAndComments, capture("lang", targetLanguageNode)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, lang } = ($$ ?? {});
 return { name, language: lang }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const typeWs: Parser<any> = untagCapture((input, pos) => {
  const __base = (capture("chars", zeroOrMore(choice(charClass(" ", "\t", "\n", "\r"), actionLineComment, actionBlockComment))));
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

export const typeObject: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("{"), capture("parts", zeroOrMore(actionContent)), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { parts } = ($$ ?? {});
 return { text: "{" + parts.join("") + "}" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const typeParen: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("("), capture("w1", typeWs), capture("inner", lazy(() => typeUnion)), capture("w2", typeWs), literal(")")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { w1, inner, w2 } = ($$ ?? {});

    return { text: "(" + w1 + inner.text + w2 + ")" };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const typeNamed: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("n", identifierName), capture("g", optional(captureSequence(capture("w1", typeWs), literal("<"), commit(capture("w2", typeWs)), commit(capture("a1", lazy(() => typeUnion))), commit(capture("arest", zeroOrMore(captureSequence(capture("c1", typeWs), literal(","), capture("c2", typeWs), capture("a", lazy(() => typeUnion)))))), commit(capture("w3", typeWs)), commit(literal(">")))))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { n, g } = ($$ ?? {});

    if (g.length === 0) return { text: n, head: { name: n } };
    const p = g[0];
    let inner = p.w2 + p.a1.text;
    for (const r of p.arest) inner += r.c1 + "," + r.c2 + r.a.text;
    inner += p.w3;
    return { text: n + p.w1 + "<" + inner + ">", head: { name: n, generic: inner } };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const typePrimary: Parser<any> = untagCapture(choice(typeObject, typeParen, typeNamed));

export const typePostfix: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("p", typePrimary), capture("arr", zeroOrMore(sequence(typeWs, literal("["), typeWs, literal("]"))))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { p, arr } = ($$ ?? {});

    let text = p.text;
    for (const a of arr) text += a[0] + "[" + a[2] + "]";
    return arr.length === 0 && p.head ? { text, head: p.head } : { text };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const typeUnion: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(typeWs, capture("first", typePostfix), capture("rest", zeroOrMore(sequence(typeWs, choice(literal("|"), literal("&")), typeWs, typePostfix)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = ($$ ?? {});

    let text = first.text;
    for (const r of rest) text += r[0] + r[1] + r[2] + r[3].text;
    return rest.length === 0 && first.head ? { text, head: first.head } : { text };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const parameterType: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("name", identifierName), wsAndComments, literal(":"), wsAndComments, capture("t", typeUnion)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, t } = ($$ ?? {});

    return { name, type: t.text, optional: false };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const parameterList: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("("), wsAndComments, capture("items", optional(sequence(parameterType, zeroOrMore(sequence(wsAndComments, literal(","), wsAndComments, parameterType))))), wsAndComments, literal(")")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = ($$ ?? {});

    if (items.length === 0) return [];
    const [first, rest] = items[0];
    return [first, ...rest.map((r: any) => r[3])];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const returnTypeSpec: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(wsAndComments, literal("->"), wsAndComments, capture("t", typeUnion)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { t } = ($$ ?? {});

    return t.head
      ? (t.head.generic !== undefined ? { type: t.head.name, generic: t.head.generic } : { type: t.head.name })
      : { type: t.text };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const transformFunctionNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("trivia", wsAndCommentsOrDocs), capture("name", identifierName), wsAndComments, capture("params", parameterList), capture("ret", returnTypeSpec), wsAndComments, capture("body", actionBlock)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { trivia, name, params, ret, body } = ($$ ?? {});

    const documentation = trivia.filter((t: any) => typeof t === "object" && t !== null).map((t: any) => t.doc);
    const fn: any = { name, parameters: params, returnType: ret, body };
    if (documentation.length > 0) fn.documentation = documentation;
    return fn;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const transformFunctions: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("first", transformFunctionNode), capture("rest", zeroOrMore(transformFunctionNode))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = ($$ ?? {});

    return [first, ...rest];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const transformDefinitionNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(wsAndComments, literal("transforms"), wsAndCommentsPlus, capture("info", transformSetName), wsAndComments, literal("{"), capture("functions", transformFunctions), wsAndComments, literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { info, functions } = ($$ ?? {});

    return {
      type: "TransformDefinition",
      transformSet: { name: info.name, targetLanguage: info.language, functions },
    };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const grammarItemNode: Parser<any> = untagCapture(choice((input, pos) => {
  const __base = (capture("e", exportDeclarationNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { e } = ($$ ?? {});
 return { kind: "export", value: e }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("l", moduleInfoListAnnotationNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { l } = ($$ ?? {});
 return { kind: "moduleInfoList", key: l.key, values: l.values }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("r", moduleInfoRecordAnnotationNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { r } = ($$ ?? {});
 return { kind: "moduleInfoRecord", key: r.key, values: r.values }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("ar", annotatedRuleNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { ar } = ($$ ?? {});
 return { kind: "rule", value: ar }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("a", grammarAnnotationNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { a } = ($$ ?? {});
 return { kind: "annotation", value: a }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("rule", ruleDefinitionNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { rule } = ($$ ?? {});
 return { kind: "rule", value: rule }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("t", transformDefinitionNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { t } = ($$ ?? {});
 return { kind: "transform", value: t }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("d", docCommentNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { d } = ($$ ?? {});
 return d; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("c", singleLineCommentNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return { kind: "comment" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, (input, pos) => {
  const __base = (capture("c", blockCommentNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
 return { kind: "comment" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}));

export const grammarItemWithWs: Parser<any> = untagCapture(sequence(grammarItemNode, interWs));

export const grammarItemsNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(interWs, capture("items", zeroOrMore(grammarItemWithWs))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = ($$ ?? {});
 return items.map((i: any) => i[0]); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const modularGrammarBlockNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(leadingContent, literal("grammar"), interWsPlus, capture("name", dottedGrammarName), leadingContent, capture("ext", optional(grammarExtendsClause)), leadingContent, capture("inc", optional(grammarIncludesClause)), leadingContent, literal("{"), capture("items", grammarItemsNode), interWs, literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, ext, inc, items } = ($$ ?? {});

    const annotations: any[] = [];
    const rules: any[] = [];
    const transforms: any[] = [];
    const exportedRules: string[] = [];
    let hasExport = false;
    const moduleInfoLists: Record<string, string[]> = {};
    const moduleInfoRecords: Record<string, Record<string, string>> = {};
    // `///` documentation items accumulate and attach to the next rule's
    // `documentation` field; any other item kind drops a pending run --
    // mirrors grammar.ts's separateGrammarItems.
    let pendingDocs: string[] = [];

    for (const i of items) {
      if (i.kind === "annotation") { annotations.push(i.value); pendingDocs = []; }
      else if (i.kind === "rule") {
        rules.push(pendingDocs.length > 0 ? { ...i.value, documentation: pendingDocs } : i.value);
        pendingDocs = [];
      }
      else if (i.kind === "transform") { transforms.push(i.value); pendingDocs = []; }
      else if (i.kind === "export") { hasExport = true; exportedRules.push(...i.value.rules); pendingDocs = []; }
      else if (i.kind === "moduleInfoList") {
        moduleInfoLists[i.key] = [...(moduleInfoLists[i.key] ?? []), ...i.values];
        pendingDocs = [];
      } else if (i.kind === "moduleInfoRecord") {
        moduleInfoRecords[i.key] = { ...moduleInfoRecords[i.key], ...i.values };
        pendingDocs = [];
      } else if (i.kind === "documentation") pendingDocs.push(i.value);
      // "comment" -- ignored, and does not break a pending doc run
    }

    const version = annotations.find((a: any) => a.key === "version")?.value;
    const dependencies = moduleInfoLists["dependencies"];
    const conflicts = moduleInfoLists["conflicts"];
    const requires = moduleInfoRecords["requires"];

    const result: any = { type: "ModularGrammarDefinition", name, annotations, rules, transforms };

    if (hasExport) {
      result.exports = { type: "ExportDeclaration", rules: exportedRules };
    }
    if (version || dependencies || conflicts || requires) {
      const moduleInfo: any = { type: "ModuleInfo" };
      if (dependencies !== undefined) moduleInfo.dependencies = dependencies;
      if (conflicts !== undefined) moduleInfo.conflicts = conflicts;
      if (version !== undefined) moduleInfo.version = version;
      if (requires !== undefined) moduleInfo.requires = requires;
      result.moduleInfo = moduleInfo;
    }
    if (ext.length > 0) result.extends = ext[0];
    if (inc.length > 0) result.includes = inc[0];

    return result;
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const tpegFileNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(capture("imports", zeroOrMore(sequence(leadingContent, importStatementNode))), capture("grammar", modularGrammarBlockNode)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { imports, grammar } = ($$ ?? {});

    return { imports: imports.map((i: any) => i[1]), grammar };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});
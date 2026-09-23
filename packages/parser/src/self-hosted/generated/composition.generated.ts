import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClass, charClassRun, choice, commit, lazy, literal, negatedCharClass, notPredicate, oneOrMore, optional, quantified, sequence, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

export const namedEscape: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\"), capture("c", charClass("n", "r", "t", "b", "f", "v", "0"))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});

    if (c === "n") return "\n"; if (c === "r") return "\r"; if (c === "t") return "\t";
    if (c === "b") return "\b"; if (c === "f") return "\f"; if (c === "v") return "\v";
    return "\0";
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const unicodeBracedEscape: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\u{"), capture("digits", quantified(charClass(["0", "9"], ["a", "f"], ["A", "F"]), 1, 6)), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { digits } = ($$ ?? {});

    const cp = parseInt(digits.join(""), 16);
    if (cp > 0x10ffff) throw new Error("Invalid Unicode code point: \\u{" + digits.join("") + "} is above U+10FFFF");
    return String.fromCodePoint(cp);
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const unicodeEscape4: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\u"), capture("digits", quantified(charClass(["0", "9"], ["a", "f"], ["A", "F"]), 4, 4))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { digits } = ($$ ?? {});
 return String.fromCodePoint(parseInt(digits.join(""), 16)); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const hexEscape: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\x"), capture("digits", quantified(charClass(["0", "9"], ["a", "f"], ["A", "F"]), 2, 2))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { digits } = ($$ ?? {});
 return String.fromCodePoint(parseInt(digits.join(""), 16)); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const numericEscape: Parser<any> = untagCapture(choice(unicodeBracedEscape, unicodeEscape4, hexEscape));

export const stringLiteralEscape: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\"), capture("c", charClass("\"", "'", "\\"))));
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

export const classLiteralEscape: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\"), capture("c", charClass("]", "\\", "^", "-", "\"", "'"))));
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

export const escapeChar: Parser<any> = untagCapture(choice(namedEscape, numericEscape, stringLiteralEscape));

export const doubleStringChar: Parser<any> = untagCapture(choice(escapeChar, negatedCharClass("\"", "\\")));

export const singleStringChar: Parser<any> = untagCapture(choice(escapeChar, negatedCharClass("'", "\\")));

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

export const classEscape: Parser<any> = untagCapture(choice(namedEscape, numericEscape, classLiteralEscape));

export const classChar: Parser<any> = untagCapture(choice(classEscape, negatedCharClass("]", "\\", "-")));

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
 return { type: "CharacterClass", ranges, negated: negation !== null }; 
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

export const identCont: Parser<any> = untagCapture(charClassRun([["a", "z"], ["A", "Z"], ["0", "9"], "_"], 0));

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

export const wordBoundaryNode: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("\\"), capture("c", charClass("b", "B"))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = ($$ ?? {});
 return { type: "WordBoundary", negated: c === "B" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const basicSyntax: Parser<any> = untagCapture(choice(stringLiteralNode, characterClassNode, qualifiedIdentifierNode, identifierNode, wordBoundaryNode));

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

    return "${" + (first ? first.w.join("") + first.re : "") + parts.join("") + "}";
  
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

    return "(" + (first ? first.w.join("") + first.re : "") + parts.join("") + ")";
  
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
 return "{" + inner + "}" + (tail ? tail.w.join("") + tail.re : ""); 
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
 return (first ? first.w.join("") + first.re : "") + parts.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const interWs: Parser<any> = untagCapture(charClassRun([" ", "\t", "\n", "\r"], 0));

export const wsAndComments: Parser<any> = untagCapture(zeroOrMore(choice(charClass(" ", "\t", "\n", "\r"), actionLineComment, actionBlockComment)));

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

export const spanOp: Parser<any> = untagCapture((input, pos) => {
  const __base = (captureSequence(literal("@"), capture("expr", postfix)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = ($$ ?? {});
 return { type: "Span", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const prefix: Parser<any> = untagCapture(choice(positiveLookahead, negativeLookahead, spanOp, postfix));

export const labeled: Parser<any> = untagCapture(choice((input, pos) => {
  const __base = (captureSequence(capture("label", identifierName), wsAndComments, literal(":"), wsAndComments, capture("expr", prefix)));
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

export const notNextRuleStart: Parser<any> = untagCapture(notPredicate(sequence(identifierName, wsAndComments, literal("="))));

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

    if (act === null) return base;
    const code = act.code;
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
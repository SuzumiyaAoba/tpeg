import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { capture, captureSequence, charClass, charClassRun, choice, commit, literal, negatedCharClass, notPredicate, oneOrMore, optional, quantified, sequence, untagCapture, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

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

export const stringLiteral: Parser<any> = untagCapture(choice(doubleQuotedString, singleQuotedString));

export const classEscape: Parser<any> = untagCapture(choice(namedEscape, numericEscape, classLiteralEscape));

export const classChar: Parser<any> = untagCapture(choice(classEscape, negatedCharClass("]", "\\", "^", "-")));

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

export const characterClass: Parser<any> = untagCapture(choice(characterClassBrackets, anyCharDot));

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

export const identifier: Parser<any> = untagCapture((input, pos) => {
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

export const qualifiedIdentifier: Parser<any> = untagCapture((input, pos) => {
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

export const basicSyntax: Parser<any> = untagCapture(choice(stringLiteral, characterClass, qualifiedIdentifier, identifier));
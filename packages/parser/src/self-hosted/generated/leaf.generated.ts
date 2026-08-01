import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { capture, captureSequence, charClass, choice, literal, negatedCharClass, oneOrMore, optional, sequence, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

export const escapeChar: Parser<any> = sequence(literal("\\"), charClass("n", "r", "t", "\\", "\"", "'"));

export const doubleStringChar: Parser<any> = choice((input, pos) => {
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
}, negatedCharClass("\"", "\\"));

export const singleStringChar: Parser<any> = choice((input, pos) => {
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
}, negatedCharClass("'", "\\"));

export const doubleQuotedString: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("\""), capture("chars", zeroOrMore(doubleStringChar)), literal("\"")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = $$;
 return { type: "StringLiteral", value: chars.join(""), quote: '"' }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const singleQuotedString: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("'"), capture("chars", zeroOrMore(singleStringChar)), literal("'")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = $$;
 return { type: "StringLiteral", value: chars.join(""), quote: "'" }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const stringLiteral: Parser<any> = choice(doubleQuotedString, singleQuotedString);

export const classEscapeStd: Parser<any> = (input, pos) => {
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
};

export const classEscapeSpecial: Parser<any> = (input, pos) => {
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
};

export const classChar: Parser<any> = choice(classEscapeStd, classEscapeSpecial, negatedCharClass("]", "\\", "^", "-"));

export const charRangePair: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("start", classChar), literal("-"), capture("end", classChar)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { start, end } = $$;
 return { start, end }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const charRangeSingle: Parser<any> = (input, pos) => {
  const __base = (capture("start", classChar));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { start } = $$;
 return { start }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const charRange: Parser<any> = choice(charRangePair, charRangeSingle);

export const characterClassBrackets: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("["), capture("negation", optional(literal("^"))), capture("ranges", oneOrMore(charRange)), literal("]")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { negation, ranges } = $$;
 return { type: "CharacterClass", ranges, negated: negation.length > 0 }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const anyCharDot: Parser<any> = (input, pos) => {
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
};

export const characterClass: Parser<any> = choice(characterClassBrackets, anyCharDot);

export const identStart: Parser<any> = charClass(["a", "z"], ["A", "Z"], "_");

export const identCont: Parser<any> = zeroOrMore(charClass(["a", "z"], ["A", "Z"], ["0", "9"], "_"));

export const identifierName: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("start", identStart), capture("rest", identCont)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { start, rest } = $$;
 return start + rest.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const identifier: Parser<any> = (input, pos) => {
  const __base = (capture("name", identifierName));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name } = $$;
 return { type: "Identifier", name }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const qualifiedIdentifier: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("module", identifierName), literal("."), capture("name", identifierName)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { module, name } = $$;
 return { type: "QualifiedIdentifier", module, name }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const basicSyntax: Parser<any> = choice(stringLiteral, characterClass, qualifiedIdentifier, identifier);
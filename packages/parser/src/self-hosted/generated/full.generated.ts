import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, charClass, charClassRun, choice, lazy, literal, negatedCharClass, notPredicate, oneOrMore, optional, sequence, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

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

export const stringLiteralNode: Parser<any> = choice(doubleQuotedString, singleQuotedString);

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

export const characterClassNode: Parser<any> = choice(characterClassBrackets, anyCharDot);

export const identStart: Parser<any> = charClass(["a", "z"], ["A", "Z"], "_");

export const identCont: Parser<any> = charClassRun([["a", "z"], ["A", "Z"], ["0", "9"], "_"], 0);

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

export const identifierNode: Parser<any> = (input, pos) => {
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

export const qualifiedIdentifierNode: Parser<any> = (input, pos) => {
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

export const basicSyntax: Parser<any> = choice(stringLiteralNode, characterClassNode, qualifiedIdentifierNode, identifierNode);

export const escapedActionChar: Parser<any> = (input, pos) => {
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
};

export const doubleQuotedActionString: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("\""), capture("chars", zeroOrMore(choice(escapedActionChar, negatedCharClass("\"", "\\")))), literal("\"")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = $$;
 return '"' + chars.join("") + '"'; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const singleQuotedActionString: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("'"), capture("chars", zeroOrMore(choice(escapedActionChar, negatedCharClass("'", "\\")))), literal("'")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = $$;
 return "'" + chars.join("") + "'"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const templateActionString: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("`"), capture("chars", zeroOrMore(choice(escapedActionChar, negatedCharClass("`", "\\")))), literal("`")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = $$;
 return "`" + chars.join("") + "`"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const actionStringLiteral: Parser<any> = choice(doubleQuotedActionString, singleQuotedActionString, templateActionString);

export const lineCommentChar: Parser<any> = (input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal("\n"), literal("\r"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = $$;
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const blockCommentChar: Parser<any> = (input, pos) => {
  const __base = (captureSequence(notPredicate(literal("*/")), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = $$;
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const actionLineComment: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("//"), capture("chars", zeroOrMore(lineCommentChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = $$;
 return "//" + chars.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const actionBlockComment: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("/*"), capture("chars", zeroOrMore(blockCommentChar)), literal("*/")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { chars } = $$;
 return "/*" + chars.join("") + "*/"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const nestedActionBlock: Parser<any> = (input, pos) => {
  const __base = (capture("inner", lazy(() => actionBlock)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { inner } = $$;
 return "{" + inner + "}"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const actionPlainChar: Parser<any> = (input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal("{"), literal("}"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = $$;
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const actionContent: Parser<any> = choice(nestedActionBlock, actionStringLiteral, actionLineComment, actionBlockComment, actionPlainChar);

export const actionBlock: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("{"), capture("parts", zeroOrMore(actionContent)), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { parts } = $$;
 return parts.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const interWs: Parser<any> = charClassRun([" ", "\t", "\n", "\r"], 0);

export const interWsPlus: Parser<any> = charClassRun([" ", "\t", "\n", "\r"], 1);

export const sameLineWs: Parser<any> = charClassRun([" ", "\t"], 0);

export const group: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("("), interWs, capture("expr", lazy(() => choiceExpr)), interWs, literal(")")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = $$;
 return { type: "Group", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const primary: Parser<any> = choice(group, basicSyntax);

export const integer: Parser<any> = (input, pos) => {
  const __base = (capture("digits", charClassRun([["0", "9"]], 1)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { digits } = $$;
 return parseInt(digits.join(""), 10); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const quantifiedRange: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("{"), capture("min", integer), literal(","), capture("max", integer), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { min, max } = $$;
 return { min, max }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const quantifiedMin: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("{"), capture("min", integer), literal(","), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { min } = $$;
 return { min, max: undefined }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const quantifiedExact: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("{"), capture("n", integer), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { n } = $$;
 return { min: n, max: n }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const quantifiedOp: Parser<any> = choice(quantifiedRange, quantifiedMin, quantifiedExact);

export const starOp: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("expr", primary), literal("*")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = $$;
 return { type: "Star", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const plusOp: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("expr", primary), literal("+")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = $$;
 return { type: "Plus", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const optionalOp: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("expr", primary), literal("?")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = $$;
 return { type: "Optional", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const quantOp: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("expr", primary), capture("q", quantifiedOp)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr, q } = $$;
 return { type: "Quantified", expression: expr, min: q.min, max: q.max }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const postfix: Parser<any> = choice(starOp, plusOp, optionalOp, quantOp, primary);

export const positiveLookahead: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("&"), capture("expr", postfix)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = $$;
 return { type: "PositiveLookahead", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const negativeLookahead: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("!"), capture("expr", postfix)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { expr } = $$;
 return { type: "NegativeLookahead", expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const prefix: Parser<any> = choice(positiveLookahead, negativeLookahead, postfix);

export const labeled: Parser<any> = choice((input, pos) => {
  const __base = (captureSequence(capture("label", identifierName), literal(":"), capture("expr", prefix)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { label, expr } = $$;
 return { type: "LabeledExpression", label, expression: expr }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
}, prefix);

export const notNextRuleStart: Parser<any> = notPredicate(sequence(identifierName, sameLineWs, literal("=")));

export const sequenceContinuation: Parser<any> = sequence(interWs, notNextRuleStart, labeled);

export const sequenceBase: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("first", labeled), capture("rest", zeroOrMore(sequenceContinuation))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = $$;

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
};

export const alternative: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("base", sequenceBase), capture("act", optional(sequence(interWs, actionBlock)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { base, act } = $$;

    if (act.length === 0) return base;
    return { type: "ActionExpression", expression: base, code: act[0][1] };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const choiceExpr: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("first", alternative), capture("rest", zeroOrMore(sequence(interWs, literal("/"), interWs, alternative)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = $$;

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
};

export const ruleDefinitionNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, capture("name", identifierName), interWs, literal("="), interWs, capture("pattern", choiceExpr)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, pattern } = $$;

    return { type: "RuleDefinition", name, pattern };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const annotationValueQuoted: Parser<any> = (input, pos) => {
  const __base = (capture("s", stringLiteralNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { s } = $$;
 return s.value; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const annotationValue: Parser<any> = choice(annotationValueQuoted, identifierName);

export const keyValueAnnotation: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, literal("@"), capture("key", identifierName), interWs, literal(":"), interWs, capture("value", annotationValue)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key, value } = $$;

    return { type: "GrammarAnnotation", key, value };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const flagAnnotation: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, literal("@"), capture("key", identifierName)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key } = $$;

    return { type: "GrammarAnnotation", key, value: "" };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const grammarAnnotationNode: Parser<any> = choice(keyValueAnnotation, flagAnnotation);

export const singleLineCommentNode: Parser<any> = (input, pos) => {
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
};

export const blockCommentNode: Parser<any> = (input, pos) => {
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
};

export const quotedStringValue: Parser<any> = (input, pos) => {
  const __base = (capture("s", stringLiteralNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { s } = $$;
 return s.value; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const importAlias: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWsPlus, literal("as"), interWsPlus, capture("name", identifierName)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name } = $$;
 return name; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const selectiveImportList: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("{"), interWs, capture("items", optional(sequence(identifierName, zeroOrMore(sequence(interWs, literal(","), interWs, identifierName))))), interWs, literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = $$;

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
};

export const simpleImportNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("import"), interWsPlus, capture("path", quotedStringValue), capture("alias", optional(importAlias))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { path, alias } = $$;

    return { type: "ImportStatement", modulePath: path, alias: alias[0] };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const selectiveImportNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("import"), interWsPlus, capture("path", quotedStringValue), interWsPlus, capture("selective", selectiveImportList)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { path, selective } = $$;

    return { type: "ImportStatement", modulePath: path, selective };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const versionedImportNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("import"), interWsPlus, capture("path", quotedStringValue), interWsPlus, literal("version"), interWsPlus, capture("version", quotedStringValue), capture("alias", optional(importAlias))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { path, version, alias } = $$;

    return { type: "ImportStatement", modulePath: path, alias: alias[0], version };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const importStatementNode: Parser<any> = choice(versionedImportNode, selectiveImportNode, simpleImportNode);

export const exportRuleList: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("["), interWs, capture("items", optional(sequence(identifierName, zeroOrMore(sequence(interWs, literal(","), interWs, identifierName))))), interWs, literal("]")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = $$;

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
};

export const exportDeclarationNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, literal("@export"), interWs, literal(":"), interWs, capture("rules", exportRuleList)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { rules } = $$;

    return { type: "ExportDeclaration", rules };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const quotedStringList: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("["), interWs, capture("items", optional(sequence(stringLiteralNode, zeroOrMore(sequence(interWs, literal(","), interWs, stringLiteralNode))))), interWs, literal("]")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = $$;

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
};

export const moduleInfoListAnnotationNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, literal("@"), capture("key", identifierName), interWs, literal(":"), interWs, capture("values", quotedStringList)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key, values } = $$;

    return { type: "ModuleInfoListAnnotation", key, values };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const quotedStringRecordEntry: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("key", stringLiteralNode), interWs, literal(":"), interWs, capture("value", stringLiteralNode)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key, value } = $$;
 return [key.value, value.value]; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const quotedStringRecord: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("{"), interWs, capture("items", optional(sequence(quotedStringRecordEntry, zeroOrMore(sequence(interWs, literal(","), interWs, quotedStringRecordEntry))))), interWs, literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = $$;

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
};

export const moduleInfoRecordAnnotationNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, literal("@"), capture("key", identifierName), interWs, literal(":"), interWs, capture("values", quotedStringRecord)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { key, values } = $$;

    return { type: "ModuleInfoRecordAnnotation", key, values };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const dottedGrammarName: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("first", identifierName), capture("rest", zeroOrMore(sequence(literal("."), identifierName)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = $$;

    return [first, ...rest.map((r: any) => r[1])].join(".");
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const grammarExtendsClause: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("extends"), interWsPlus, capture("name", dottedGrammarName)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name } = $$;
 return name; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const grammarIncludesClause: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("includes"), interWsPlus, capture("first", dottedGrammarName), capture("rest", zeroOrMore(sequence(interWs, literal(","), interWs, dottedGrammarName)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = $$;

    return [first, ...rest.map((r: any) => r[3])];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const targetLanguageNode: Parser<any> = choice((input, pos) => {
  const __base = (captureSequence(capture("lang", literal("typescript")), notPredicate(lazy(() => langChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { lang } = $$;
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
    const { lang } = $$;
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
    const { lang } = $$;
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
    const { lang } = $$;
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
    const { lang } = $$;
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
    const { lang } = $$;
 return lang; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
});

export const langChar: Parser<any> = charClass(["a", "z"], ["A", "Z"], ["0", "9"]);

export const transformSetName: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("name", identifierName), interWs, literal("@"), interWs, capture("lang", targetLanguageNode)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, lang } = $$;
 return { name, language: lang }; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const typeChar: Parser<any> = choice(charClass(["a", "z"], ["A", "Z"], ["0", "9"], "_"), literal("<"), literal(">"), literal("["), literal("]"));

export const typeBraceContentChar: Parser<any> = (input, pos) => {
  const __base = (captureSequence(notPredicate(choice(literal("{"), literal("}"))), capture("c", anyChar())));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { c } = $$;
 return c; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const typeBraceContent: Parser<any> = (input, pos) => {
  const __base = (capture("parts", zeroOrMore(choice(lazy(() => typeBraceBlock), typeBraceContentChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { parts } = $$;
 return parts.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const typeBraceBlock: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("{"), capture("inner", typeBraceContent), literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { inner } = $$;
 return "{" + inner + "}"; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const complexTypeNode: Parser<any> = (input, pos) => {
  const __base = (capture("parts", oneOrMore(choice(typeBraceBlock, typeChar))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { parts } = $$;
 return parts.join(""); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const parameterType: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("name", identifierName), interWs, literal(":"), interWs, capture("type", complexTypeNode)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, type } = $$;

    return { name, type, optional: false };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const parameterList: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("("), interWs, capture("items", optional(sequence(parameterType, zeroOrMore(sequence(interWs, literal(","), interWs, parameterType))))), interWs, literal(")")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = $$;

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
};

export const genericTypeParam: Parser<any> = (input, pos) => {
  const __base = (captureSequence(literal("<"), capture("name", identifierName), literal(">")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name } = $$;
 return name; 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const returnTypeSpec: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, literal("->"), interWs, capture("base", identifierName), capture("generic", optional(genericTypeParam))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { base, generic } = $$;

    return generic.length > 0 ? { type: base, generic: generic[0] } : { type: base };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const transformFunctionNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, capture("name", identifierName), interWs, capture("params", parameterList), capture("ret", returnTypeSpec), interWs, capture("body", actionBlock)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, params, ret, body } = $$;

    return { name, parameters: params, returnType: ret, body };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const transformFunctions: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("first", transformFunctionNode), capture("rest", zeroOrMore(sequence(interWs, transformFunctionNode)))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { first, rest } = $$;

    return [first, ...rest.map((r: any) => r[1])];
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const transformDefinitionNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, literal("transforms"), interWsPlus, capture("info", transformSetName), interWs, literal("{"), interWs, capture("functions", transformFunctions), interWs, literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { info, functions } = $$;

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
};

export const grammarItemNode: Parser<any> = choice((input, pos) => {
  const __base = (capture("e", exportDeclarationNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { e } = $$;
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
    const { l } = $$;
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
    const { r } = $$;
 return { kind: "moduleInfoRecord", key: r.key, values: r.values }; 
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
    const { a } = $$;
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
    const { rule } = $$;
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
    const { t } = $$;
 return { kind: "transform", value: t }; 
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
});

export const grammarItemWithWs: Parser<any> = sequence(grammarItemNode, interWs);

export const grammarItemsNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, capture("items", zeroOrMore(grammarItemWithWs))));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { items } = $$;
 return items.map((i: any) => i[0]); 
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};

export const modularGrammarBlockNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, literal("grammar"), interWsPlus, capture("name", dottedGrammarName), interWs, capture("ext", optional(grammarExtendsClause)), interWs, capture("inc", optional(grammarIncludesClause)), interWs, literal("{"), capture("items", grammarItemsNode), interWs, literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, ext, inc, items } = $$;

    const annotations = items.filter((i: any) => i.kind === "annotation").map((i: any) => i.value);
    const rules = items.filter((i: any) => i.kind === "rule").map((i: any) => i.value);
    const transforms = items.filter((i: any) => i.kind === "transform").map((i: any) => i.value);

    const exportedRules: string[] = [];
    for (const i of items) {
      if (i.kind === "export") exportedRules.push(...i.value.rules);
    }

    const moduleInfoLists: Record<string, string[]> = {};
    for (const i of items) {
      if (i.kind === "moduleInfoList") {
        moduleInfoLists[i.key] = [...(moduleInfoLists[i.key] ?? []), ...i.values];
      }
    }

    const moduleInfoRecords: Record<string, Record<string, string>> = {};
    for (const i of items) {
      if (i.kind === "moduleInfoRecord") {
        moduleInfoRecords[i.key] = { ...moduleInfoRecords[i.key], ...i.values };
      }
    }

    const version = annotations.find((a: any) => a.key === "version")?.value;
    const dependencies = moduleInfoLists["dependencies"];
    const conflicts = moduleInfoLists["conflicts"];
    const requires = moduleInfoRecords["requires"];

    const result: any = { type: "ModularGrammarDefinition", name, annotations, rules, transforms };

    if (exportedRules.length > 0) {
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
};

export const tpegFileNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(capture("imports", zeroOrMore(sequence(interWs, importStatementNode))), capture("grammar", modularGrammarBlockNode)));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { imports, grammar } = $$;

    return { imports: imports.map((i: any) => i[1]), grammar };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};
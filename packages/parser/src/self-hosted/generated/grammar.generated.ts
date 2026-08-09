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

export const grammarItemNode: Parser<any> = choice((input, pos) => {
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
  const __base = (capture("r", ruleDefinitionNode));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { r } = $$;
 return { kind: "rule", value: r }; 
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

export const grammarBlockNode: Parser<any> = (input, pos) => {
  const __base = (captureSequence(interWs, literal("grammar"), interWsPlus, capture("name", identifierName), interWs, literal("{"), capture("items", grammarItemsNode), interWs, literal("}")));
  const __result = __base(input, pos);
  if (!__result.success) return __result;
  const __val = (() => {
    const $$: any = __result.val;
    const { name, items } = $$;

    const rules = items.filter((i: any) => i.kind === "rule").map((i: any) => i.value);
    const annotations = items.filter((i: any) => i.kind === "annotation").map((i: any) => i.value);
    return { type: "GrammarDefinition", name, annotations, rules, transforms: [] };
  
  })();
  return {
    success: true,
    val: __val,
    current: __result.current,
    next: __result.next,
  };
};
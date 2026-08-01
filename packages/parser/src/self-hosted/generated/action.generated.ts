import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { anyChar, capture, captureSequence, choice, lazy, literal, negatedCharClass, notPredicate, sequence, zeroOrMore } from "@suzumiyaaoba/tpeg-core";

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

export const actionString: Parser<any> = choice(doubleQuotedActionString, singleQuotedActionString, templateActionString);

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

export const actionContent: Parser<any> = choice(nestedActionBlock, actionString, actionLineComment, actionBlockComment, actionPlainChar);

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
import { describe, expect, test } from "bun:test";
import { grammarDefinition as handGrammarDefinition } from "../grammar";
import { grammarBlockNode as genGrammarDefinition } from "./generated/grammar.generated";

const pos = { offset: 0, line: 1, column: 1 };

const cases = [
  `grammar Simple {
  greeting = "hello"
}`,

  `grammar WithAnnotations {
  @version: "1.0"
  @description: "test"
  @start: expression
  expression = "a" / "b"
}`,

  `grammar Multi {
  number = [0-9]+
  greeting = "hello"
  combined = number greeting
}`,

  `grammar MultiLineSequence {
  choice = "a"
         / "b"
         / "c"
}`,

  `grammar WithComments {
  // a leading comment
  number = [0-9]+ // trailing comment doesn't matter here
}`,

  // multi-line action with nested braces - exactly the case the manual
  // brace-depth pre-scan in grammar.ts was built for
  `grammar WithAction {
  number = digits:[0-9]+ {
    const value = { parsed: parseInt(digits.join("")) };
    return value.parsed;
  }
}`,

  // rule immediately followed by another rule with no blank line - the
  // exact ambiguity the negative-lookahead technique targets
  `grammar Adjacent {
  first = "a"
  second = "b"
}`,

  // action ending on the same line as the grammar's own closing brace
  `grammar SameLineClose {
  number = [0-9]+ { return 1; } }`,

  // character class containing braces, immediately before a rule with a
  // multi-line action - the interaction test from action-expression.spec.ts
  `grammar BracesInCharClass {
  sep = [{}]
  number = digits:[0-9]+ {
    const value = { parsed: parseInt(digits.join("")) };
    return value.parsed;
  }
}`,

  `grammar FlagAnnotation {
  @private
  hidden = "x"
}`,

  `grammar Empty {
}`,
];

describe("self-hosted grammar-block layer vs grammar.ts's grammarDefinition", () => {
  for (const input of cases) {
    test(input.slice(0, 60).replace(/\n/g, "\\n"), () => {
      const a = handGrammarDefinition(input, pos);
      const b = genGrammarDefinition(input, pos);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) {
        expect(b.val).toEqual(a.val);
        expect(b.next.offset).toEqual(a.next.offset);
      }
    });
  }
});

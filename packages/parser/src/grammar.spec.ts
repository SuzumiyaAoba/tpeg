/**
 * Tests for Grammar Definition Block parsing (Phase 1.6)
 */

import { describe, expect, test } from "bun:test";
import { type Parser, parse } from "@suzumiyaaoba/tpeg-core";

// Helper function for easier testing
const testParse = <T>(parser: Parser<T>, input: string) => parse(parser)(input);
import {
  documentationComment,
  grammarAnnotation,
  grammarDefinition,
  modularGrammarDefinition,
  quotedString,
  ruleDefinition,
  singleLineComment,
} from "./grammar";

describe("Grammar Definition Block Tests", () => {
  describe("quotedString", () => {
    test("should parse double-quoted strings", () => {
      const result = testParse(quotedString, '"hello world"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello world");
      }
    });

    test("should parse single-quoted strings", () => {
      const result = testParse(quotedString, "'hello world'");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello world");
      }
    });

    test("should handle escaped characters", () => {
      const result = testParse(quotedString, '"hello \\"world\\""');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe('hello "world"');
      }
    });
  });

  describe("singleLineComment", () => {
    test("should parse single-line comments", () => {
      const result = testParse(singleLineComment, "// This is a comment");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("This is a comment");
      }
    });

    test("should handle empty comments", () => {
      const result = testParse(singleLineComment, "//");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("");
      }
    });
  });

  describe("documentationComment", () => {
    test("should parse documentation comments", () => {
      const result = testParse(
        documentationComment,
        "/// This is documentation",
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("This is documentation");
      }
    });
  });

  describe("grammarAnnotation", () => {
    test("should parse version annotation", () => {
      const result = testParse(grammarAnnotation, '@version: "1.0"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          type: "GrammarAnnotation",
          key: "version",
          value: "1.0",
        });
      }
    });

    test("should parse description annotation", () => {
      const result = testParse(
        grammarAnnotation,
        '@description: "A simple grammar"',
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          type: "GrammarAnnotation",
          key: "description",
          value: "A simple grammar",
        });
      }
    });

    test("should handle whitespace around colon", () => {
      const result = testParse(grammarAnnotation, '@start : "expression"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          type: "GrammarAnnotation",
          key: "start",
          value: "expression",
        });
      }
    });

    test("should parse a bare identifier value, as docs/peg-grammar.md's @start/@skip examples use", () => {
      const result = testParse(grammarAnnotation, "@start: expression");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          type: "GrammarAnnotation",
          key: "start",
          value: "expression",
        });
      }
    });

    test("should parse a flag-only annotation with no value, e.g. @private", () => {
      const result = testParse(grammarAnnotation, "@private");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          type: "GrammarAnnotation",
          key: "private",
          value: "",
        });
      }
    });

    test("should not let a flag-only match swallow a real @key: value annotation", () => {
      // @version has to still consume its full ": \"1.0\"" value - a naive
      // "flag annotation tried first" implementation would match just
      // "@version" and leave ": \"1.0\"" as unparsed trailing input.
      const result = testParse(grammarAnnotation, '@version: "1.0"');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({
          type: "GrammarAnnotation",
          key: "version",
          value: "1.0",
        });
      }
    });
  });

  describe("ruleDefinition", () => {
    test("should parse simple rule definition", () => {
      const result = testParse(ruleDefinition, "number = [0-9]+");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("RuleDefinition");
        expect(result.val.name).toBe("number");
        expect(result.val.pattern).toBeDefined();
        expect(result.val.documentation).toBeUndefined();
      }
    });

    test("should parse rule with whitespace", () => {
      const result = testParse(ruleDefinition, "  expression  =  left:term  ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("expression");
      }
    });
  });

  describe("@memoize rule annotation", () => {
    test("attaches a bare `@memoize` flag to the following rule", () => {
      const input = `grammar X {
        @memoize
        expr = [0-9]+
      }`;
      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.annotations).toHaveLength(0);
        expect(result.val.rules).toHaveLength(1);
        expect(result.val.rules[0]?.annotations).toEqual([
          { type: "GrammarAnnotation", key: "memoize", value: "" },
        ]);
      }
    });

    test("attaches `@memoize: N` with its numeric value to the following rule", () => {
      const input = `grammar X {
        @memoize: 256
        expr = [0-9]+
      }`;
      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules[0]?.annotations).toEqual([
          { type: "GrammarAnnotation", key: "memoize", value: "256" },
        ]);
      }
    });

    test("leaves a rule with no leading annotation without an annotations field", () => {
      const input = `grammar X {
        expr = [0-9]+
      }`;
      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules[0]?.annotations).toBeUndefined();
      }
    });

    test("only annotates the rule @memoize directly precedes, not other rules in the block", () => {
      const input = `grammar X {
        @memoize: 10
        first = "a"
        second = "b"
      }`;
      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules).toHaveLength(2);
        expect(result.val.rules[0]?.name).toBe("first");
        expect(result.val.rules[0]?.annotations).toEqual([
          { type: "GrammarAnnotation", key: "memoize", value: "10" },
        ]);
        expect(result.val.rules[1]?.name).toBe("second");
        expect(result.val.rules[1]?.annotations).toBeUndefined();
      }
    });

    test("does not consume `@start` immediately preceding a rule -- it stays a block-level annotation", () => {
      // Regression guard: annotatedRuleDefinition is restricted to the
      // literal "memoize" key precisely so this common pattern (a
      // block-level annotation with no blank line before the rule it
      // describes) keeps working.
      const input = `grammar X {
        @start: expression
        expression = [0-9]+
      }`;
      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.annotations).toEqual([
          { type: "GrammarAnnotation", key: "start", value: "expression" },
        ]);
        expect(result.val.rules).toHaveLength(1);
        expect(result.val.rules[0]?.name).toBe("expression");
        expect(result.val.rules[0]?.annotations).toBeUndefined();
      }
    });

    test("supports multiple @memoize annotations directly preceding the same rule", () => {
      const input = `grammar X {
        @memoize
        @memoize: 5
        expr = [0-9]+
      }`;
      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules[0]?.annotations).toEqual([
          { type: "GrammarAnnotation", key: "memoize", value: "" },
          { type: "GrammarAnnotation", key: "memoize", value: "5" },
        ]);
      }
    });
  });

  describe("grammarDefinition", () => {
    test("should parse grammar with annotations and single rule", () => {
      const input = `grammar SimpleCalc {
        @version: "1.0"
        @start: "expression"
        
        expression = [0-9]+
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("GrammarDefinition");
        expect(result.val.name).toBe("SimpleCalc");
        expect(result.val.annotations).toHaveLength(2);
        expect(result.val.rules).toHaveLength(1);

        expect(result.val.annotations[0]).toEqual({
          type: "GrammarAnnotation",
          key: "version",
          value: "1.0",
        });

        expect(result.val.annotations[1]).toEqual({
          type: "GrammarAnnotation",
          key: "start",
          value: "expression",
        });

        expect(result.val.rules[0]?.name).toBe("expression");
      }
    });

    test("should parse a grammar block mixing quoted, bare-identifier, and flag-only annotations, matching docs/peg-grammar.md's actual syntax", () => {
      const input = `grammar SimpleCalc {
        @version: "1.0"
        @start: expression
        @skip: whitespace
        @private

        expression = [0-9]+
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.annotations).toEqual([
          { type: "GrammarAnnotation", key: "version", value: "1.0" },
          { type: "GrammarAnnotation", key: "start", value: "expression" },
          { type: "GrammarAnnotation", key: "skip", value: "whitespace" },
          { type: "GrammarAnnotation", key: "private", value: "" },
        ]);
        expect(result.val.rules).toHaveLength(1);
      }
    });

    test("should parse a dotted (namespaced) grammar name, as docs/peg-grammar.md's module-resolution examples use (e.g. `grammar Math.Core`)", () => {
      const input = `grammar Math.Core {
        expression = [0-9]+
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("Math.Core");
      }
    });

    test("should parse a rule body that spans multiple lines via a labeled choice with '/' continuations, as docs/peg-grammar.md's JSON grammar example does", () => {
      // Regression test for grammarRuleExpression: it used to stop
      // unconditionally at the first newline, so any rule body split across
      // lines (rather than just any rule body containing an internal
      // newline) would be truncated mid-expression and fail to parse.
      const input = `grammar JSON {
        value =
          string:string_literal /
          number:number_literal /
          "true"

        string_literal = [0-9]+
        number_literal = [0-9]+
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules).toHaveLength(3);
        expect(result.val.rules[0]?.name).toBe("value");
        expect(result.val.rules[0]?.pattern.type).toBe("Choice");
      }
    });

    test("should not mistake a same-line '}' inside a rule's own string literal or character class for the grammar block's closing brace", () => {
      // Regression test: the multi-line rule body fix above needed a "}"
      // boundary check to replace the old "stop at any newline" behavior,
      // but a "}" on the *same line* as the rule (inside a string literal or
      // character class) isn't the block's closing brace - only a "}"
      // reached by crossing an actual line break is.
      const input = `grammar X {
        sep = " }"
        chars = [ }]
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules).toHaveLength(2);
        expect(result.val.rules[0]?.name).toBe("sep");
        expect(result.val.rules[1]?.name).toBe("chars");
      }
    });

    test("should not mistake a same-line grammar-block-closing '}' for part of the rule (regression: used to only recognize a '}' reached by crossing a line break)", () => {
      // `grammarRuleExpression` used to require `crossedLineBreak` before
      // treating a bare "}" as the enclosing grammar block's own close --
      // a same-line "grammar G { r = ... }" never crosses a line break
      // before reaching its "}", so it fell through to the generic
      // one-char-at-a-time path and got silently absorbed into `r`'s own
      // slice. Harmless before the full-consumption check below existed
      // (only `expression()`'s own `next` mattered), but would otherwise
      // make that check reject this legitimate, single-line shape.
      const result = testParse(grammarDefinition, 'grammar G { r = "x" }');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules).toHaveLength(1);
        expect(result.val.rules[0]?.name).toBe("r");
      }
    });

    test("should treat a trailing '@annotation' right after a rule as a separate grammar item, not part of the rule's own body", () => {
      // Regression: without an explicit "@" boundary case, an annotation
      // separated from the preceding rule by only whitespace/a comment
      // (no intervening rule) got silently absorbed into that rule's own
      // slice instead of starting a new grammarItem -- exactly the shape
      // docs/peg-grammar.md's own examples use (a `@skip: whitespace`
      // annotation placed directly above the rule it documents).
      const input = `grammar G {
        mul_op = "*" / "/"
        // comment
        @skip: whitespace
        whitespace = [ ]+
      }`;
      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules.map((r) => r.name)).toEqual([
          "mul_op",
          "whitespace",
        ]);
        expect(result.val.annotations).toContainEqual(
          expect.objectContaining({ key: "skip", value: "whitespace" }),
        );
      }
    });

    test("rejects a rule followed by unrecognizable trailing content instead of silently truncating the rule (regression: grammarRuleExpression didn't check it consumed its whole slice)", () => {
      // A digit, unlike an identifier or "@", can never legitimately
      // start a new grammarItem or continue `expression()`'s own
      // grammar -- it must be a mistake, not silently accepted as
      // `start = "x"` with "42" dropped on the floor.
      const result = testParse(ruleDefinition, 'start = "x" 42\n  other = "y"');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain(
          "Unexpected content after rule expression",
        );
      }
    });

    test("does not reject a rule followed only by trailing whitespace/comments (regression guard for the check above)", () => {
      const withLineComment = testParse(
        grammarDefinition,
        'grammar G {\n  start = "x" // note\n  other = "y"\n}',
      );
      expect(withLineComment.success).toBe(true);

      const withOwnLineComment = testParse(
        grammarDefinition,
        'grammar G {\n  start = "x"\n  // note\n  other = "y"\n}',
      );
      expect(withOwnLineComment.success).toBe(true);
    });

    test("should correctly bound a rule whose body spans multiple lines and contains a `~` cut marker", () => {
      // grammarRuleExpression's boundary scanner has explicit cases for
      // string/char-class/comment/brace content but otherwise just advances
      // one character at a time - confirm "~" falls through that generic
      // path harmlessly and doesn't get mistaken for a rule/block boundary,
      // and that the next rule after it is still parsed as a separate item.
      const input = `grammar X {
        if_stmt =
          "if" ~
          cond
          "then"
          body

        other = "x"
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.rules).toHaveLength(2);
        expect(result.val.rules[0]?.name).toBe("if_stmt");
        expect(result.val.rules[0]?.pattern.type).toBe("Sequence");
        if (result.val.rules[0]?.pattern.type === "Sequence") {
          const elements = result.val.rules[0].pattern.elements;
          expect(elements.map((e) => e.type)).toEqual([
            "StringLiteral",
            "Cut",
            "Identifier",
            "StringLiteral",
            "Identifier",
          ]);
        }
        expect(result.val.rules[1]?.name).toBe("other");
      }
    });

    test("should continue a multi-line sequence onto a line starting with 'identifier (group)'", () => {
      // The next-rule boundary check only fires on "identifier ws* =", not
      // "identifier ws* (" - deliberately: grammarItem's transform
      // alternative is transformDefinition, which requires a literal
      // "transforms" keyword, so a bare "identifier(...)" is never itself a
      // valid next grammarItem to guard against. Treating "(" as a boundary
      // too would instead break exactly this legitimate case: a sequence
      // continued on the next line with a rule reference immediately
      // followed by a group.
      const input = 'expr = "a"\n         foo (bar)';

      const result = testParse(ruleDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.pattern.type).toBe("Sequence");
      }
    });

    test("should report an accurate line/column after a rule body spanning multiple lines", () => {
      // Regression test: grammarRuleExpression used to recompute the
      // returned line/column from the *rule's own start* position plus a
      // raw character offset, which is only correct for single-line bodies.
      // For a multi-line body it must reflect the sub-parse's own
      // (newline-aware) end position instead.
      const input = `grammar X {
  value =
    "a" /
    "b"
}`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.next).toEqual(input.length);
      }
    });

    test("should handle empty grammar block", () => {
      const input = `grammar Empty {
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("Empty");
        expect(result.val.annotations).toHaveLength(0);
        expect(result.val.rules).toHaveLength(0);
      }
    });

    test("should handle grammar with single rule only", () => {
      const input = `grammar TestGrammar {
        expression = [a-zA-Z]+
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("TestGrammar");
        expect(result.val.annotations).toHaveLength(0);
        expect(result.val.rules).toHaveLength(1);
        expect(result.val.rules[0]?.name).toBe("expression");
      }
    });

    test("should parse multiple rules with newlines", () => {
      const input = `grammar MultiRule {
        @version: "1.0"
        @start: "expression"
        
        expression = term (("+" / "-") term)*
        term = factor (("*" / "/") factor)*
        factor = number / "(" expression ")"
        number = [0-9]+ ("." [0-9]+)?
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe("GrammarDefinition");
        expect(result.val.name).toBe("MultiRule");
        expect(result.val.annotations).toHaveLength(2);
        expect(result.val.rules).toHaveLength(4);

        // Check rule names
        const ruleNames = result.val.rules.map((rule) => rule.name);
        expect(ruleNames).toEqual(["expression", "term", "factor", "number"]);

        // Verify each rule has proper structure
        expect(result.val.rules[0]?.name).toBe("expression");
        expect(result.val.rules[0]?.pattern.type).toBe("Sequence");

        expect(result.val.rules[1]?.name).toBe("term");
        expect(result.val.rules[1]?.pattern.type).toBe("Sequence");

        expect(result.val.rules[2]?.name).toBe("factor");
        expect(result.val.rules[2]?.pattern.type).toBe("Choice");

        expect(result.val.rules[3]?.name).toBe("number");
        expect(result.val.rules[3]?.pattern.type).toBe("Sequence");
      }
    });

    test("should parse simple two rules", () => {
      const input = `grammar Simple {
        rule1 = "hello"
        rule2 = "world"
      }`;

      const result = testParse(grammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("Simple");
        expect(result.val.annotations).toHaveLength(0);
        expect(result.val.rules).toHaveLength(2);

        expect(result.val.rules[0]?.name).toBe("rule1");
        expect(result.val.rules[0]?.pattern.type).toBe("StringLiteral");

        expect(result.val.rules[1]?.name).toBe("rule2");
        expect(result.val.rules[1]?.pattern.type).toBe("StringLiteral");
      }
    });
  });

  describe("modularGrammarDefinition: @dependencies/@conflicts array annotations", () => {
    test("should parse @dependencies/@conflicts array-of-quoted-strings annotations into moduleInfo, as docs/peg-grammar.md's module-dependency example uses", () => {
      const input = `grammar ModuleA {
        @dependencies: ["base.tpeg", "utils.tpeg"]
        @conflicts: ["legacy.tpeg"]

        rule_a = "x"
      }`;

      // grammarDefinition parses the same input without failing - the
      // array annotations are recognized and discarded, same as @export.
      const plain = testParse(grammarDefinition, input);
      expect(plain.success).toBe(true);

      const result = testParse(modularGrammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.moduleInfo).toEqual({
          type: "ModuleInfo",
          dependencies: ["base.tpeg", "utils.tpeg"],
          conflicts: ["legacy.tpeg"],
        });
      }
    });

    test("should not create a moduleInfo when there is nothing to put in it", () => {
      const input = `grammar Empty2 {
        rule_a = "x"
      }`;

      const result = testParse(modularGrammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.moduleInfo).toBeUndefined();
      }
    });
  });

  describe("modularGrammarDefinition: extends clause", () => {
    test("should parse a plain 'extends Name' clause", () => {
      const input = `grammar MyGrammar extends base.Base {
        rule_a = "x"
      }`;

      const plain = testParse(grammarDefinition, input);
      expect(plain.success).toBe(true);

      const result = testParse(modularGrammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("MyGrammar");
        expect(result.val.extends).toBe("base.Base");
      }
    });

    test("should parse an 'extends module.Dotted.Name' clause where the extended grammar's own name is dotted, as docs/peg-grammar.md's module-resolution example uses", () => {
      const input = `grammar Math.Advanced extends core.Math.Core {
        factor = number
      }`;

      const result = testParse(modularGrammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("Math.Advanced");
        expect(result.val.extends).toBe("core.Math.Core");
      }
    });

    test("should leave extends undefined when absent", () => {
      const input = `grammar Standalone {
        rule_a = "x"
      }`;

      const result = testParse(modularGrammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.extends).toBeUndefined();
      }
    });
  });

  describe("modularGrammarDefinition: @requires record annotation", () => {
    test('should parse a multi-line @requires: { "key": "value", ... } annotation into moduleInfo.requires, as docs/peg-grammar.md\'s module-versioning example uses', () => {
      const input = `grammar MyGrammar extends base.Base {
        @requires: {
          "base.tpeg": "^1.0",
          "operators.tpeg": ">=2.0, <3.0"
        }

        rule_a = "x"
      }`;

      const plain = testParse(grammarDefinition, input);
      expect(plain.success).toBe(true);

      const result = testParse(modularGrammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.moduleInfo).toEqual({
          type: "ModuleInfo",
          requires: {
            "base.tpeg": "^1.0",
            "operators.tpeg": ">=2.0, <3.0",
          },
        });
      }
    });
  });

  describe("modularGrammarDefinition: includes mixin clause", () => {
    test("should parse an 'includes a.B, c.D, e.F' mixin clause, as docs/peg-grammar.md's module-composition example uses", () => {
      const input = `grammar ProgrammingLanguage
        includes lit.Literals, ops.Operators, expr.Expressions {

        program = statement*
      }`;

      const plain = testParse(grammarDefinition, input);
      expect(plain.success).toBe(true);

      const result = testParse(modularGrammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("ProgrammingLanguage");
        expect(result.val.includes).toEqual([
          "lit.Literals",
          "ops.Operators",
          "expr.Expressions",
        ]);
      }
    });

    test("should leave includes undefined when absent", () => {
      const input = `grammar Standalone2 {
        rule_a = "x"
      }`;

      const result = testParse(modularGrammarDefinition, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.includes).toBeUndefined();
      }
    });
  });
});

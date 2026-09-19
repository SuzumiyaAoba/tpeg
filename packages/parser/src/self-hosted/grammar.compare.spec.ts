import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { describe, expect, test } from "vite-plus/test";
import { grammarDefinition as handGrammarDefinition } from "../grammar";
import { grammarBlockNode as genGrammarDefinition } from "./generated/grammar.generated";

const pos = 0;

/**
 * A generated parser's semantic action has no way to produce a
 * backtrackable ParseFailure, so the self-hosted grammar encodes
 * "reject this input" checks (backwards char ranges, reversed/overflowing
 * quantifier bounds, quantifier-shaped action blocks) as thrown Errors --
 * those propagate out of the generated parser where the hand-written
 * parser returns a failure. Both reject the input; normalize a throw to
 * `success: false` so the comparison covers that.
 */
const callGen = (parser: Parser<unknown>, input: string) => {
  try {
    return parser(input, pos);
  } catch {
    return { success: false as const };
  }
};

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

  // next rule's "=" on a different line than its name -- the boundary the
  // wsAndComments-inclusive notNextRuleStart lookahead exists for (the
  // hand-written grammarRuleExpression accepts the same shape via
  // optionalWhitespaceOrComment between a rule's name and "=")
  `grammar NewlineAssign {
  x = "a"
  y
    = "b"
}`,

  // same, with a comment in the name/"=" gap
  `grammar CommentAssign {
  x = "a"
  y /* c */ = "b"
}`,

  `grammar Empty {
}`,

  // `///` documentation comments and `/* */` block comments as their own
  // grammar items (issue #102) -- `///` attaches to the next rule's
  // `documentation` field on both sides
  `grammar G {
  /// a doc comment
  r = "a"
}`,
  `grammar G {
  /// doc line one
  /// doc line two
  r = "a"
}`,
  `grammar G {
  /* a block comment */
  r = "a"
}`,
  `/* leading block comment */
grammar G {
  r = "x"
}`,
  `grammar G /* header comment */ {
  r = "x"
}`,

  // `@memoize`/`@memoize: N` attaches to the FOLLOWING rule's
  // `annotations`, not the grammar block's (issue #97) -- including the
  // comment-tolerant ":" gap and a comment between annotation and rule
  `grammar G {
  @memoize
  r = "x"
}`,
  `grammar G {
  @memoize: 4
  r = "x"
}`,
  `grammar G {
  @memoize /* c */ : /* c */ 4
  r = "x"
}`,
  `grammar G {
  @memoize
  // a comment between annotation and rule
  r = "x"
}`,
  // `@start`/`@version` directly above a rule must NOT misattach as
  // rule-level annotations -- only the literal "memoize" key does that
  `grammar G {
  @version: "1.0"
  @start: expression
  expression = "x"
}`,

  // module-metadata annotations parse (and are discarded) identically:
  // `@export`, `@dependencies`/`@conflicts` lists, `@requires` records
  `grammar G {
  @export: [a, b]
  a = "x"
  b = "y"
}`,
  `grammar G {
  @dependencies: ["a.tpeg", "b.tpeg"]
  @requires: { "a.tpeg": "^1.0" }
  r = "x"
}`,
  // a malformed `@export` (quoted names where the dedicated form wants
  // bare identifiers) is a parse error on both sides, not a generic
  // annotation
  `grammar G {
  @export: "a"
  a = "x"
}`,

  // dotted grammar name and extends/includes clauses -- accepted then
  // discarded by grammarDefinition on both sides
  `grammar a.b.C {
  r = "x"
}`,
  `grammar G extends base.Other {
  r = "x"
}`,
  `grammar G includes a.B, c.D {
  r = "x"
}`,

  // transforms blocks DO survive on a plain GrammarDefinition (its
  // `transforms` field) -- a rule named e.g. "transformsFoo" is a rule,
  // not a transform boundary, and `///` before a function attaches to
  // its `documentation` field
  `grammar G {
  r = "x"
  transforms TypescriptTransform@typescript {
    toAst(n: any) -> Node { return n; }
  }
}`,
  `grammar G {
  transforms T@python {
    /// function docs
    emit(x: string, y: number) -> Result<string[]> { return x; }
    helper() -> void { return; }
  }
}`,
  `grammar G {
  transformsFoo = "x"
}`,
  // malformed @export followed by a transforms block still fails wholesale
  `grammar G {
  @export: "a"
  transforms T@rust {
    f() -> int { return 0; }
  }
}`,

  // a rule boundary needs NO whitespace before the next rule's name --
  // `=` can never continue an expression, so `x=` (adjacent or spaced)
  // ends `r` on both sides. The hand-written boundary scan used to only
  // check the position after a whitespace run, absorbing `x` into `r`'s
  // body and then failing on the stranded `=`.
  `grammar G { r = "a"x="b" }`,
  `grammar G { r = "a"x = "b" }`,
  `grammar G { r = "a" x="b" }`,
  `grammar G { r = "a"transforms = "b" }`,

  // `transforms` as an expression identifier: exempt from the
  // rule-boundary check as a sequence's/alternative's/group's FIRST
  // element and as a lookahead's operand on both sides (the self-hosted
  // grammar's notNextRuleStart guards continuations only)
  `grammar G { r = "a" / transforms x }`,
  `grammar G { r = (transforms x) }`,
  `grammar G { r = &transforms x }`,
  `grammar G { r = !transforms x }`,
  `grammar G { r = transforms x }`,
  // ...but NOT exempt in continuation position: `transforms` there starts
  // a transforms block (or fails one), on both sides
  `grammar G { r = "a" transforms x }`,
  `grammar G { r = "a" ~ transforms x }`,
  `grammar G { r = "a" transforms T@typescript {
    f() -> void { return; }
  } }`,

  // a label's `name:expr` expression is ANOTHER fresh element position
  // (`expr` is prefix-level, like `&`'s operand): `name:transforms`
  // labels a rule reference named `transforms`, not a transforms-block
  // boundary -- a `:` directly before the identifier must exempt it from
  // the continuation-boundary check exactly like `/`, `(`, `&`, `!` do
  `grammar G { r = name:transforms }`,
  `grammar G { r = l:transforms }`,
  `grammar G { r = "a" name:transforms x }`,
  `grammar G { r = name:transforms x }`,
  // ...while a label on a COMPLETE expression leaves `transforms` in
  // continuation position, where it's still a boundary on both sides
  `grammar G { r = n:"a" transforms }`,
  `grammar G { r = n : transforms }`,

  // ---- `@expr` span operator vs `@annotation` (grammar.ts's
  // isAnnotationStartAt / the grammar layer's `annotationStart`): an
  // `@` NOT followed by an identifier is always a span; `@identifier`
  // is a span too, unless a `:`, another `@`, or a rule boundary
  // (`name =`, `transforms`, `}`) follows it -- where the annotation
  // reading wins on both sides.
  `grammar G {
  r = @"a"
}`,
  `grammar G {
  r = @[a-z]+
}`,
  `grammar G {
  r = @("a" / "b")
}`,
  `grammar G {
  r = @x "a"
  x = "b"
}`,
  // `@x` directly before the next rule's header is a flag annotation,
  // not a span -- the body ends there on both sides (`@(x)` is the
  // explicit way to force the span reading)
  `grammar G {
  r = "a" @x
  x = "b"
}`,
  `grammar G {
  r = "a" @(x)
  x = "b"
}`,
  `grammar G {
  r = "a" w:@(x)
  x = "b"
}`,
  `grammar G {
  r = "a" @noskip
  x = "b"
}`,
  // an annotation-shaped `@` truncates the body EVERYWHERE the scanner
  // can see it -- inside label operands, post-`/` first elements, and
  // group interiors alike (the hand-written scanner counts BRACE
  // depth, not parens) -- leaving a body the expression grammar can't
  // finish, on both sides
  `grammar G {
  r = "a" w:@x
  x = "b"
}`,
  `grammar G {
  r = "a" / @x
  x = "b"
}`,
  `grammar G {
  r = (@x
  x = "b")
}`,
  `grammar G {
  r = @x
  x = "b"
}`,
  // ...but a span operand position before a NON-boundary token is a
  // span even where it visually resembles an annotation
  `grammar G {
  r = "a" @x "b"
  x = "c"
}`,

  // `\b`/`\B` word-boundary assertions as expression leaves
  `grammar G {
  r = \\b w:[a-z]+ \\b
}`,
  `grammar G {
  r = "a" \\B "b"
}`,
];

describe("self-hosted grammar-block layer vs grammar.ts's grammarDefinition", () => {
  for (const input of cases) {
    test(input.slice(0, 60).replace(/\n/g, "\\n"), () => {
      const a = handGrammarDefinition(input, pos);
      const b = callGen(genGrammarDefinition, input);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) {
        expect(b.val).toEqual(a.val);
        expect(b.next).toEqual(a.next);
      }
    });
  }
});

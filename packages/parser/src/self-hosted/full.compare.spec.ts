import { describe, expect, test } from "vite-plus/test";
import { modularGrammarDefinition, tpegModuleFile } from "../grammar";
import { transformDefinition as handTransformDefinition } from "../transforms";
import {
  modularGrammarBlockNode as genModularGrammarBlock,
  transformDefinitionNode as genTransformDefinition,
  tpegFileNode as genTpegFile,
} from "./generated/full.generated";

const pos = 0;

describe("self-hosted transformDefinitionNode vs transforms.ts's transformDefinition", () => {
  const cases = [
    `transforms T@typescript { f() -> X { return 1; } }`,

    `transforms Compute@python {
  add(a: number, b: number) -> number { return a + b; }
  identity(x: string) -> string { return x; }
}`,

    // complex (object-literal) parameter and return-type-with-generic
    `transforms T@typescript {
  parse(input: { raw: string, pos: number }) -> Result<Node> { return input; }
}`,

    // language names that share a prefix must still resolve to the
    // longest/correct one, and a longer identifier must not be mistaken
    // for a shorter language name
    `transforms T@go { f() -> X { return 1; } }`,
    `transforms T@rust { f() -> X { return 1; } }`,
    `transforms T@java { f() -> X { return 1; } }`,
    `transforms T@cpp { f() -> X { return 1; } }`,

    // failure cases: an unsupported language, and a transform set with no
    // functions at all (transformFunctions requires at least one)
    `transforms T@ruby { f() -> X { return 1; } }`,
    `transforms T@typescript { }`,
  ];

  for (const input of cases) {
    test(input.slice(0, 60).replace(/\n/g, "\\n"), () => {
      const a = handTransformDefinition(input, pos);
      const b = genTransformDefinition(input, pos);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) {
        expect(b.val).toEqual(a.val);
        expect(b.next).toEqual(a.next);
      }
    });
  }
});

describe("self-hosted modularGrammarBlockNode vs grammar.ts's modularGrammarDefinition", () => {
  const cases = [
    // plain grammars (no module/transform constructs) - regression coverage
    // against the same inputs 04-grammar.tpeg's layer already covers
    `grammar Simple {
  greeting = "hello"
}`,
    `grammar WithComments {
  // a leading comment
  number = [0-9]+ // trailing comment doesn't matter here
}`,
    `grammar Empty {
}`,

    // @export, including the empty-list case (no `exports` field at all,
    // since grammar.ts only sets it when exportedRules.length > 0)
    `grammar G {
  @export: [a, b]
  a = "x"
  b = "y"
}`,
    `grammar G {
  @export: []
  r = "x"
}`,

    // @dependencies/@conflicts accumulate across repeated annotations,
    // @requires merges, and @version feeds both moduleInfo and annotations
    `grammar G {
  @version: "1.0"
  @dependencies: ["a.tpeg"]
  @dependencies: ["b.tpeg"]
  @conflicts: ["legacy.tpeg"]
  @requires: { "a.tpeg": "^1.0" }
  r = "x"
}`,

    // @namespace is NOT parsed into moduleInfo.namespace by grammar.ts -
    // it stays a generic annotation, same as any other unrecognized @key
    `grammar G {
  @namespace: "Foo"
  r = "x"
}`,

    // extends/includes, with dotted and module-qualified names
    `grammar G extends base.Other includes a.B, c.D {
  r = "x"
}`,

    // a transforms block is preserved on GrammarDefinition too, as long as
    // it appears where grammarRuleExpression's own boundary-scan can find
    // it (see the README's "transforms after a rule" limitation below)
    `grammar G {
  transforms T@typescript { f() -> X { return 1; } }
  r = "a"
}`,

    // /// documentation comments and /* */ block comments are accepted and
    // discarded identically by both parsers (see README: RuleDefinition's
    // `documentation` field is never actually populated by grammar.ts)
    `grammar G {
  /// a doc comment
  r = "a"
}`,
    `grammar G {
  /* a block comment */
  r = "a"
}`,

    // a rule immediately followed by a transforms block in the same grammar
    // block: grammarRuleExpression's boundary scan doesn't recognize
    // "transforms" as a rule/block boundary (see this directory's README),
    // so it greedily swallows the transforms block into the rule's own
    // pattern and fails - reproduced here, not worked around, to keep this
    // grammar an honest model of the hand-written parser's actual behavior
    `grammar G {
  r = "a"
  transforms T@typescript { f() -> X { return 1; } }
}`,
  ];

  for (const input of cases) {
    test(input.slice(0, 60).replace(/\n/g, "\\n"), () => {
      const a = modularGrammarDefinition(input, pos);
      const b = genModularGrammarBlock(input, pos);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) {
        expect(b.val).toEqual(a.val);
        expect(b.next).toEqual(a.next);
      }
    });
  }
});

describe("self-hosted tpegFileNode vs grammar.ts's tpegModuleFile", () => {
  const cases = [
    `import "base.tpeg" as base
grammar G extends base.Other includes a.B, c.D {
  r = base.rule
}`,

    `import "base.tpeg" { rule1, rule2 }
grammar G {
  r = "x"
}`,

    `import "base.tpeg" version "^1.0" as base
grammar G {
  r = "x"
}`,

    // multiple imports, no alias
    `import "a.tpeg"
import "b.tpeg"
grammar G {
  r = "x"
}`,

    // no imports at all - a bare modular grammar block is still a valid file
    `grammar G {
  r = "x"
}`,
  ];

  for (const input of cases) {
    test(input.slice(0, 60).replace(/\n/g, "\\n"), () => {
      const a = tpegModuleFile(input, pos);
      const b = genTpegFile(input, pos);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) {
        expect(b.val).toEqual(a.val);
        expect(b.next).toEqual(a.next);
      }
    });
  }
});

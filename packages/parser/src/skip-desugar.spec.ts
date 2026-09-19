/**
 * Tests for `@skip` automatic-whitespace desugaring -- the pass
 * (`skip-desugar.ts`), its validation (`grammar-validation.ts`), and the
 * behavior of the parsers every generator emits for a `@skip` grammar
 * (whitespace consumed at sequence boundaries WITHOUT changing the
 * rule's own value shape -- see the `IGNORED` sentinel in
 * `packages/core/src/ignored.ts`).
 *
 * Two fixture styles, matching `grammar-validation.spec.ts`: real
 * `.tpeg` source through `grammarDefinition` for the parse-to-desugar
 * pipeline, and hand-built ASTs where inspecting the inserted `Skip`
 * nodes directly is clearer.
 */

import { describe, expect, it } from "vite-plus/test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import type {
  Expression,
  GrammarDefinition,
  Parser,
  RuleDefinition,
  Sequence,
} from "@suzumiyaaoba/tpeg-core";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { grammarDefinition } from "./grammar";
import { validateGrammar } from "./grammar-validation";
import { makeReferenceInterpreter } from "./reference-interpreter";
import { applySkipDesugar, resolveSkipRuleName } from "./skip-desugar";
import {
  createGrammarAnnotation,
  createGrammarDefinition,
  createIdentifier,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "./types";

/** Parses `.tpeg` source text (wrapped in a `grammar G { ... }` block)
 * and returns its `GrammarDefinition` -- fails the test immediately if
 * the SOURCE TEXT itself doesn't parse, so a malformed fixture is never
 * silently mistaken for a validation rejection. */
const grammarFromSource = (body: string): GrammarDefinition => {
  const result = parse(grammarDefinition)(`grammar G {\n  ${body}\n}`);
  if (!result.success) {
    throw new Error(`test fixture failed to parse: ${result.error.message}`);
  }
  return result.val;
};

/** `true` iff `expr` is a `Skip` node whose reference names `name`. */
const isSkipTo = (expr: Expression, name: string): boolean =>
  expr.type === "Skip" && expr.expression.name === name;

/** Counts `Skip` nodes anywhere in `expr` (via a plain recursive walk so
 * this test doesn't depend on the very traversal helpers under test). */
const countSkips = (expr: Expression): number => {
  let found = expr.type === "Skip" ? 1 : 0;
  const children: readonly Expression[] =
    expr.type === "Sequence"
      ? expr.elements
      : expr.type === "Choice"
        ? expr.alternatives
        : "expression" in expr
          ? [expr.expression]
          : [];
  for (const child of children) {
    found += countSkips(child);
  }
  return found;
};

const ruleByName = (
  grammar: GrammarDefinition,
  name: string,
): RuleDefinition => {
  const rule = grammar.rules.find((r) => r.name === name);
  if (!rule) throw new Error(`fixture is missing rule "${name}"`);
  return rule;
};

/**
 * Evaluates a generated module against the real tpeg-core/tpeg-combinator
 * exports, exactly like `codegen.spec.ts`'s runtime tests: `import`
 * statements and `export const` declarations are rewritten into plain
 * `const`s inside a `new Function` scope. Returns a `Record` keyed by
 * the literal `ruleNames` (a generic mapped type, so `mod.start` is a
 * concrete `Parser`, not `Parser | undefined` the way a
 * `Record<string, _>` index lookup is under
 * `noUncheckedIndexedAccess`) -- verifying each name produced a
 * function along the way.
 */
const runGenerated = async <N extends string>(
  code: string,
  ruleNames: readonly N[],
): Promise<Record<N, Parser<unknown>>> => {
  const core = await import("@suzumiyaaoba/tpeg-core");
  const combinator = await import("@suzumiyaaoba/tpeg-combinator");
  const scope = { ...combinator, ...core };
  const body = code
    .replace(/^import[^\n]*\n?/gm, "")
    .replace(/^export const (\w+)(: Parser<[^>]*>)?/gm, "const $1");
  const moduleFactory = new Function(
    ...Object.keys(scope),
    `${body}\nreturn { ${ruleNames.join(", ")} };`,
  );
  const mod = moduleFactory(...Object.values(scope)) as Record<string, unknown>;
  const out = {} as Record<N, Parser<unknown>>;
  for (const name of ruleNames) {
    const parser = mod[name];
    if (typeof parser !== "function") {
      throw new Error(`generated module did not produce rule "${name}"`);
    }
    out[name] = parser as Parser<unknown>;
  }
  return out;
};

describe("resolveSkipRuleName", () => {
  it("returns null when the grammar has no @skip annotation", () => {
    const grammar = grammarFromSource('start = "a"');
    expect(resolveSkipRuleName(grammar)).toBeNull();
  });

  it("returns null for a bare `@skip` flag (validateGrammar rejects it separately)", () => {
    const grammar = grammarFromSource('@skip\nstart = "a"');
    expect(resolveSkipRuleName(grammar)).toBeNull();
  });

  it("returns the rule name a `@skip: <name>` annotation selects", () => {
    const grammar = grammarFromSource('@skip: ws\nstart = "a"\nws = " "*');
    expect(resolveSkipRuleName(grammar)).toBe("ws");
  });
});

describe("applySkipDesugar", () => {
  it("returns the identical grammar object when there is no usable @skip", () => {
    const grammar = grammarFromSource('start = "a" "b"');
    expect(applySkipDesugar(grammar)).toBe(grammar);
  });

  it("inserts a Skip at a sequence's start, between elements, and at its end", () => {
    const grammar = grammarFromSource('@skip: ws\nstart = "a" "b"\nws = " "*');
    const desugared = applySkipDesugar(grammar);
    const pattern = ruleByName(desugared, "start").pattern;
    expect(pattern.type).toBe("Sequence");
    const elements = (pattern as Sequence).elements;
    expect(elements.map((el) => el.type)).toEqual([
      "Skip",
      "StringLiteral",
      "Skip",
      "StringLiteral",
      "Skip",
    ]);
    for (const el of elements.filter((el) => el.type === "Skip")) {
      expect(isSkipTo(el, "ws")).toBe(true);
    }
  });

  it("wraps a rule's single non-Sequence pattern in [Skip, pattern, Skip]", () => {
    const grammar = grammarFromSource('@skip: ws\nstart = "a"\nws = " "*');
    const desugared = applySkipDesugar(grammar);
    const pattern = ruleByName(desugared, "start").pattern;
    expect(pattern.type).toBe("Sequence");
    const elements = (pattern as Sequence).elements;
    expect(elements.map((el) => el.type)).toEqual([
      "Skip",
      "StringLiteral",
      "Skip",
    ]);
  });

  it("rewrites nested sequences too (e.g. inside a grouped repetition)", () => {
    const grammar = grammarFromSource(
      '@skip: ws\nstart = "a" ("b" "c")*\nws = " "*',
    );
    const desugared = applySkipDesugar(grammar);
    const pattern = ruleByName(desugared, "start").pattern;
    // Outer sequence: Skip, "a", Skip, Star(...), Skip -- the Star's
    // own body is a sequence, so it carries boundary skips of its own
    // (which is what lets each repetition iteration skip).
    const elements = (pattern as Sequence).elements;
    expect(elements.map((el) => el.type)).toEqual([
      "Skip",
      "StringLiteral",
      "Skip",
      "Star",
      "Skip",
    ]);
    const star = elements[3];
    if (star?.type !== "Star" || star.expression.type !== "Group") {
      throw new Error(`fixture AST shape unexpected: ${JSON.stringify(star)}`);
    }
    const innerSeq = star.expression.expression;
    expect(innerSeq.type).toBe("Sequence");
    expect((innerSeq as Sequence).elements.map((el) => el.type)).toEqual([
      "Skip",
      "StringLiteral",
      "Skip",
      "StringLiteral",
      "Skip",
    ]);
  });

  it("leaves a @noskip-annotated rule untouched", () => {
    const grammar = grammarFromSource(
      '@skip: ws\n@noskip\nlexeme = "a" "b"\nws = " "*',
    );
    const desugared = applySkipDesugar(grammar);
    expect(countSkips(ruleByName(desugared, "lexeme").pattern)).toBe(0);
  });

  it("leaves the skip rule itself untouched", () => {
    const grammar = grammarFromSource(
      '@skip: ws\nstart = "a" "b"\nws = " " " "?',
    );
    const desugared = applySkipDesugar(grammar);
    expect(countSkips(ruleByName(desugared, "ws").pattern)).toBe(0);
  });

  it("leaves the skip rule's transitive reference closure untouched", () => {
    // `ws` references `comment`; inserting `Skip(ws)` inside `comment`
    // would recurse ws -> comment -> ws forever, so `comment` must be
    // exempt too.
    const grammar = grammarFromSource(
      '@skip: ws\nstart = "a" "b"\nws = " "* comment?\ncomment = "/*" "c" "*/"',
    );
    const desugared = applySkipDesugar(grammar);
    expect(countSkips(ruleByName(desugared, "ws").pattern)).toBe(0);
    expect(countSkips(ruleByName(desugared, "comment").pattern)).toBe(0);
    expect(countSkips(ruleByName(desugared, "start").pattern)).toBeGreaterThan(
      0,
    );
  });

  it("extends the transitive closure through a @noskip rule's own references", () => {
    // `ws -> R -> S` with `R` `@noskip`: `S` is still invoked during the
    // skip rule's evaluation, so inserting `Skip(ws)` into `S` would both
    // recurse `ws -> R -> S -> ws` and let that skip consume input the
    // lexical `R` was never meant to see (e.g. a nested `/*x*/` inside an
    // outer comment). `S` must be exempt even though it is only reachable
    // via an already-exempt rule.
    const grammar = grammarFromSource(
      '@skip: ws\nstart = "a" "b"\nws = " "* R?\n@noskip\nR = "/*" S "*/"\nS = [a-z]',
    );
    const desugared = applySkipDesugar(grammar);
    expect(countSkips(ruleByName(desugared, "S").pattern)).toBe(0);
    expect(countSkips(ruleByName(desugared, "R").pattern)).toBe(0);
    expect(countSkips(ruleByName(desugared, "start").pattern)).toBeGreaterThan(
      0,
    );
    // And the interpreter must reject the nested comment the inserted
    // skip would otherwise have consumed inside `S`.
    const interp = makeReferenceInterpreter(grammar);
    expect(interp("a/*x*/b").ok).toBe(true);
    expect(interp("a/* /*x*/c*/b").ok).toBe(false);
  });

  it("is idempotent -- a second pass inserts no additional Skips", () => {
    const grammar = grammarFromSource(
      '@skip: ws\nstart = "a" ("b" "c") "d"\nws = " "*',
    );
    const once = applySkipDesugar(grammar);
    const twice = applySkipDesugar(once);
    expect(twice).toEqual(once);
  });

  it("preserves rule order, names, and annotations", () => {
    const grammar = grammarFromSource('@skip: ws\nstart = "a"\nws = " "*');
    const desugared = applySkipDesugar(grammar);
    expect(desugared.rules.map((r) => r.name)).toEqual(
      grammar.rules.map((r) => r.name),
    );
    expect(desugared.annotations).toEqual(grammar.annotations);
  });
});

describe("validateGrammar: @skip annotations", () => {
  it("accepts `@skip: <name>` naming a declared rule", () => {
    const grammar = grammarFromSource('@skip: ws\nstart = "a"\nws = " "*');
    expect(() => validateGrammar(grammar)).not.toThrow();
  });

  it("rejects `@skip` naming a rule the grammar does not declare", () => {
    const grammar = grammarFromSource('@skip: whitespace\nstart = "a"');
    expect(() => validateGrammar(grammar)).toThrow(/@skip.*whitespace/);
  });

  it("rejects a bare `@skip` flag with no rule name", () => {
    const grammar = grammarFromSource('@skip\nstart = "a"');
    expect(() => validateGrammar(grammar)).toThrow(
      /@skip requires a rule name/,
    );
  });

  it("rejects duplicate `@skip` annotations", () => {
    const grammar = grammarFromSource(
      '@skip: ws\n@skip: ws2\nstart = "a"\nws = " "*\nws2 = "\\t"*',
    );
    expect(() => validateGrammar(grammar)).toThrow(/duplicate @skip/i);
  });

  it("end-to-end: both generators reject a `@skip` naming a missing rule", () => {
    const grammar = grammarFromSource('@skip: missing\nstart = "a"');
    expect(() =>
      generateTypeScriptParser(grammar, {
        includeImports: false,
        includeTypes: false,
      }),
    ).toThrow(/@skip.*missing/);
    expect(() =>
      generateOptimizedTypeScriptParser(grammar, {
        language: "typescript",
        includeImports: false,
        includeTypes: false,
        optimize: true,
      }),
    ).toThrow(/@skip.*missing/);
  });
});

describe("@skip: generated parsers actually skip whitespace", () => {
  // `ws` is declared AFTER the rules that skip it on purpose, so the
  // generated `ignore(optional(lazy(() => ws)))` forward reference is
  // exercised too.
  const source =
    '@skip: ws\nstart = "a" "b"\n@noskip\nlexeme = "a" "b"\nws = [ \\t\\n]*';

  const generateBoth = (grammar: GrammarDefinition) => [
    generateTypeScriptParser(grammar, {
      includeImports: true,
      includeTypes: false,
    }).code,
    generateOptimizedTypeScriptParser(grammar, {
      language: "typescript",
      includeImports: true,
      includeTypes: false,
      optimize: true,
    }).code,
  ];

  it("both generators emit ignore(optional(...)) boundary skips and import ignore/optional", () => {
    const grammar = grammarFromSource(source);
    for (const code of generateBoth(grammar)) {
      expect(code).toContain("ignore(optional(");
      expect(code).toMatch(/import {[^}]*\bignore\b[^}]*\boptional\b/);
    }
  });

  it("skips leading, inter-token, and trailing whitespace", async () => {
    const grammar = grammarFromSource(source);
    for (const code of generateBoth(grammar)) {
      const { start } = await runGenerated(code, ["start"]);
      for (const input of ["ab", " ab", "a b", "ab ", "  a   b  ", "a\tb\n"]) {
        const result = start(input, 0);
        expect(result.success).toBe(true);
        if (result.success) {
          // Two real elements: the boundary skips contribute no slots.
          expect(result.val).toEqual(["a", "b"]);
          expect(result.next).toBe(input.length);
        }
      }
      // Whitespace INSIDE a token is still not consumed.
      expect(start("a  x", 0).success).toBe(false);
    }
  });

  it("preserves the bare value of a single-element sequence via map(...) unwrap", async () => {
    const grammar = grammarFromSource('@skip: ws\nstart = "x"\nws = " "*');
    for (const code of generateBoth(grammar)) {
      expect(code).toContain("map(sequence(");
      expect(code).toMatch(/import {[^}]*\bmap\b/);
      const { start } = await runGenerated(code, ["start"]);
      const result = start("  x  ", 0);
      expect(result.success).toBe(true);
      if (result.success) {
        // Bare "x", NOT ["x"] -- the 1-tuple the IGNORED filter would
        // otherwise leave behind is unwrapped by `map`.
        expect(result.val).toBe("x");
        expect(result.next).toBe(5);
      }
    }
  });

  it("preserves labeled-capture object shape", async () => {
    const grammar = grammarFromSource(
      '@skip: ws\nstart = x:"a" y:"b"\nws = " "*',
    );
    for (const code of generateBoth(grammar)) {
      const { start } = await runGenerated(code, ["start"]);
      const result = start(" a  b ", 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toEqual({ x: "a", y: "b" });
      }
    }
  });

  it("a @noskip rule does NOT skip inside its own pattern", async () => {
    const grammar = grammarFromSource(source);
    for (const code of generateBoth(grammar)) {
      const { lexeme } = await runGenerated(code, ["lexeme"]);
      // Boundary whitespace still belongs to the enclosing (skipping)
      // context -- but nothing INSIDE `lexeme` may skip.
      expect(lexeme("ab", 0).success).toBe(true);
      expect(lexeme("a b", 0).success).toBe(false);
    }
  });

  it("skips inside a repetition body when that body is a sequence", async () => {
    const grammar = grammarFromSource(
      '@skip: ws\nstart = "a" ("b" "c")*\nws = " "*',
    );
    for (const code of generateBoth(grammar)) {
      const { start } = await runGenerated(code, ["start"]);
      const result = start("a bc b  c", 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.next).toBe(9);
      }
    }
  });
});

describe("@skip: reference interpreter agrees with codegen", () => {
  it("consumes the same boundaries the generated parsers do", () => {
    const grammar = grammarFromSource(
      '@skip: ws\nstart = "a" "b"\nws = [ \\t\\n]*',
    );
    const interp = makeReferenceInterpreter(grammar);
    for (const [input, next] of [
      ["ab", 2],
      [" ab ", 4],
      ["a   b", 5],
      ["\t a \t b \n", 9],
    ] as const) {
      const result = interp(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.next).toBe(next);
      }
    }
    expect(interp("a  x").ok).toBe(false);
  });
});

describe("@skip: desugar invariants over hand-built ASTs", () => {
  it("a skip-rule self-reference does not produce skips inside the skip rule", () => {
    // Degenerate but legal: @skip names a rule whose own body is a
    // sequence. The closure exemption -- not just the name check -- is
    // what keeps `Skip(ws)` out of `ws`'s own pattern.
    const grammar = createGrammarDefinition(
      "Test",
      [createGrammarAnnotation("skip", "ws")],
      [
        createRuleDefinition(
          "ws",
          createSequence([
            createStringLiteral(" "),
            createStar(createStringLiteral(" ")),
          ]),
        ),
        createRuleDefinition(
          "start",
          createSequence([createStringLiteral("a"), createStringLiteral("b")]),
        ),
      ],
    );
    const desugared = applySkipDesugar(grammar);
    expect(countSkips(ruleByName(desugared, "ws").pattern)).toBe(0);
    expect(countSkips(ruleByName(desugared, "start").pattern)).toBe(3);
  });

  it("a rule reachable from the skip rule only through a non-Identifier chain is still exempt", () => {
    // `ws -> (group -> seq -> helper)`: the closure walk sees through
    // every wrapper node, not just direct Identifier children.
    const grammar = createGrammarDefinition(
      "Test",
      [createGrammarAnnotation("skip", "ws")],
      [
        createRuleDefinition(
          "ws",
          createSequence([
            createStringLiteral(" "),
            createIdentifier("helper"),
          ]),
        ),
        createRuleDefinition(
          "helper",
          createSequence([createStringLiteral("h"), createStringLiteral("i")]),
        ),
        createRuleDefinition(
          "start",
          createSequence([createStringLiteral("a"), createStringLiteral("b")]),
        ),
      ],
    );
    const desugared = applySkipDesugar(grammar);
    expect(countSkips(ruleByName(desugared, "helper").pattern)).toBe(0);
    expect(countSkips(ruleByName(desugared, "start").pattern)).toBe(3);
  });
});

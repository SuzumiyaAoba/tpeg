/**
 * Tests for the `@expr` span (source-text extraction) operator and the
 * `\b` / `\B` word-boundary assertions -- expression-level parsing,
 * the grammar-body scanner's annotation-vs-span disambiguation
 * (`isAnnotationStartAt` in `grammar.ts`), code generation parity
 * across the base/optimized generators, and runtime behavior of the
 * generated parsers.
 *
 * AST/runtime semantics live in `packages/core/src/grammar-types.ts`
 * (`Span`, `WordBoundary`), `packages/core/src/transform.ts` (`span`),
 * and `packages/core/src/boundary.ts` (`wordBoundary`/`nonWordBoundary`).
 */

import { describe, expect, it } from "vite-plus/test";
import type {
  GrammarDefinition,
  Parser,
  RuleDefinition,
} from "@suzumiyaaoba/tpeg-core";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { tpegExpression } from "./combined";
import { generateTypeScriptParser } from "./codegen";
import { generateOptimizedTypeScriptParser } from "./codegen-optimized";
import { grammarDefinition } from "./grammar";
import { makeReferenceInterpreter } from "./reference-interpreter";

/** Parses an expression fragment and asserts success, returning the AST. */
const exprFromSource = (src: string) => {
  const result = tpegExpression(src, 0);
  if (!result.success) {
    throw new Error(
      `expression fixture "${src}" failed to parse: ${result.error.message}`,
    );
  }
  if (result.next !== src.length) {
    throw new Error(
      `expression fixture "${src}" parsed partially (next=${result.next})`,
    );
  }
  return result.val;
};

/** Parses `.tpeg` source text (wrapped in `grammar G { ... }`). */
const grammarFromSource = (body: string): GrammarDefinition => {
  const result = parse(grammarDefinition)(`grammar G {\n  ${body}\n}`);
  if (!result.success) {
    throw new Error(`test fixture failed to parse: ${result.error.message}`);
  }
  return result.val;
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
 * exports, exactly like `codegen.spec.ts`/`skip-desugar.spec.ts`'s runtime
 * tests: `import` statements and `export const` declarations are rewritten
 * into plain `const`s inside a `new Function` scope.
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

describe("@expr span parsing", () => {
  it('parses @"lit" as Span(StringLiteral)', () => {
    expect(exprFromSource('@"abc"')).toEqual({
      type: "Span",
      expression: { type: "StringLiteral", value: "abc", quote: '"' },
    });
  });

  it("parses @[a-z]+ as Span(Plus) -- @ binds to the whole postfix", () => {
    const expr = exprFromSource("@[a-z]+");
    expect(expr.type).toBe("Span");
    if (expr.type === "Span") {
      expect(expr.expression.type).toBe("Plus");
    }
  });

  it("parses @(e) as Span(Group)", () => {
    const expr = exprFromSource('@("a" "b")');
    expect(expr.type).toBe("Span");
    if (expr.type === "Span") {
      expect(expr.expression.type).toBe("Group");
    }
  });

  it("parses @ident as Span(Identifier)", () => {
    expect(exprFromSource("@number")).toEqual({
      type: "Span",
      expression: { type: "Identifier", name: "number" },
    });
  });

  it('sequences a span mid-rule: @x "a"', () => {
    const expr = exprFromSource('@x "a"');
    expect(expr.type).toBe("Sequence");
    if (expr.type === "Sequence") {
      expect(expr.elements[0]?.type).toBe("Span");
      expect(expr.elements[1]?.type).toBe("StringLiteral");
    }
  });

  it("labels wrap a span: name:@x", () => {
    const expr = exprFromSource("w:@x");
    expect(expr.type).toBe("LabeledExpression");
    if (expr.type === "LabeledExpression") {
      expect(expr.label).toBe("w");
      expect(expr.expression.type).toBe("Span");
    }
  });

  it("nests spans: @(@x)", () => {
    const expr = exprFromSource("@(@x)");
    expect(expr.type).toBe("Span");
    if (expr.type === "Span" && expr.expression.type === "Group") {
      expect(expr.expression.expression.type).toBe("Span");
    }
  });

  it("does not allow a second prefix operator after @ (same single-slot rule as &/!)", () => {
    // `prefix` consumes exactly one prefix operator -- `@&x` fails to
    // parse the `&x` part as a postfix operand, leaving input behind.
    const result = tpegExpression("@&x", 0);
    // `@&x` parses `@`'s operand starting at `&` -- no postfix starts
    // with `&`, so the whole parse fails.
    expect(result.success).toBe(false);
  });
});

describe("\\b and \\B parsing", () => {
  it("parses \\b as WordBoundary(negated=false)", () => {
    expect(exprFromSource("\\b")).toEqual({
      type: "WordBoundary",
      negated: false,
    });
  });

  it("parses \\B as WordBoundary(negated=true)", () => {
    expect(exprFromSource("\\B")).toEqual({
      type: "WordBoundary",
      negated: true,
    });
  });

  it("composes into sequences: \\b [a-z]+ \\b", () => {
    const expr = exprFromSource("\\b [a-z]+ \\b");
    expect(expr.type).toBe("Sequence");
    if (expr.type === "Sequence") {
      expect(expr.elements).toHaveLength(3);
      expect(expr.elements[0]).toEqual({
        type: "WordBoundary",
        negated: false,
      });
      expect(expr.elements[1]?.type).toBe("Plus");
      expect(expr.elements[2]).toEqual({
        type: "WordBoundary",
        negated: false,
      });
    }
  });

  it("labels a boundary: w:\\b", () => {
    const expr = exprFromSource("w:\\b");
    expect(expr.type).toBe("LabeledExpression");
    if (expr.type === "LabeledExpression") {
      expect(expr.expression.type).toBe("WordBoundary");
    }
  });

  it("rejects other backslash escapes at expression level", () => {
    for (const src of ["\\n", "\\t", "\\\\", '\\"', "\\d", "\\w"]) {
      expect(tpegExpression(src, 0).success).toBe(false);
    }
  });
});

describe("annotation vs span disambiguation (grammar-body scanner)", () => {
  it('keeps @"lit" inside the rule body as a span', () => {
    const g = grammarFromSource('r = "a" @"b"\nx = "c"');
    const r = ruleByName(g, "r");
    expect(r.pattern.type).toBe("Sequence");
    if (r.pattern.type === "Sequence") {
      expect(r.pattern.elements[1]?.type).toBe("Span");
    }
    // The following rule is unaffected.
    expect(ruleByName(g, "x").pattern).toEqual({
      type: "StringLiteral",
      value: "c",
      quote: '"',
    });
  });

  it("reads a bare @ident directly before a rule header as an annotation", () => {
    // Documented ambiguity: `@x` immediately before `x = "b"` is the
    // annotation reading (write `@(x)` for the span reading) -- `r`'s
    // body ends at the `@`, and the `@x` lands as a grammar-level
    // annotation rather than inside `r`'s pattern.
    const g = grammarFromSource('r = "a"\n@x\nx = "b"');
    expect(ruleByName(g, "r").pattern).toEqual({
      type: "StringLiteral",
      value: "a",
      quote: '"',
    });
    expect(g.annotations.some((a) => a.key === "x")).toBe(true);
    // And it is NOT part of `r`'s pattern (no Span node was produced).
    expect(JSON.stringify(ruleByName(g, "r").pattern)).not.toContain("Span");
  });

  it("reads @(ident) before a rule header as a span of the reference", () => {
    const g = grammarFromSource('r = "a" @(x)\nx = "b"');
    const r = ruleByName(g, "r");
    expect(r.pattern.type).toBe("Sequence");
    if (r.pattern.type === "Sequence") {
      const span = r.pattern.elements[1];
      expect(span?.type).toBe("Span");
    }
    // `x` stays an ordinary rule with no annotation attached.
    expect(ruleByName(g, "x").annotations ?? []).toHaveLength(0);
  });

  it("keeps @ident mid-body as a span when not before a rule header", () => {
    const g = grammarFromSource('r = "a" @x "b"\nx = "c"');
    const r = ruleByName(g, "r");
    expect(r.pattern.type).toBe("Sequence");
    if (r.pattern.type === "Sequence") {
      expect(r.pattern.elements[1]).toEqual({
        type: "Span",
        expression: { type: "Identifier", name: "x" },
      });
    }
  });

  it("still parses @key: value grammar annotations", () => {
    const g = grammarFromSource('r = "a"\n@version: "1.0"\nx = "b"');
    expect(ruleByName(g, "r").pattern).toEqual({
      type: "StringLiteral",
      value: "a",
      quote: '"',
    });
  });

  it("still parses stacked flag annotations before a rule", () => {
    const g = grammarFromSource('r = "a"\n@noskip\n@memoize\nx = "b"');
    const x = ruleByName(g, "x");
    const keys = (x.annotations ?? []).map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["noskip", "memoize"]));
  });
});

describe("span and boundary codegen", () => {
  const SRC = "\\b w:@[a-z]+ \\b";

  it("emits span()/wordBoundary with the right imports (base)", () => {
    const { code } = generateTypeScriptParser(grammarFromSource(`r = ${SRC}`));
    expect(code).toContain("span(");
    expect(code).toContain("wordBoundary");
    expect(code).toMatch(
      /import \{[^}]*\bspan\b[^}]*\} from "@suzumiyaaoba\/tpeg-core"/,
    );
    expect(code).toMatch(
      /import \{[^}]*\bwordBoundary\b[^}]*\} from "@suzumiyaaoba\/tpeg-core"/,
    );
  });

  it("emits identical span/boundary code (optimized)", () => {
    const { code } = generateOptimizedTypeScriptParser(
      grammarFromSource(`r = ${SRC}`),
    );
    expect(code).toContain("span(");
    expect(code).toContain("wordBoundary");
    expect(code).toMatch(/\bspan\b/);
  });

  it("emits nonWordBoundary for \\B", () => {
    const { code } = generateTypeScriptParser(
      grammarFromSource('r = "a" \\B "b"'),
    );
    expect(code).toContain("nonWordBoundary");
  });

  it("does not import span/wordBoundary when unused", () => {
    const { code } = generateTypeScriptParser(grammarFromSource('r = "a" "b"'));
    expect(code).not.toContain("span");
    expect(code).not.toContain("wordBoundary");
    expect(code).not.toContain("nonWordBoundary");
  });

  it("generated parser: span returns consumed text, boundary asserts edges", async () => {
    const { code } = generateTypeScriptParser(grammarFromSource(`r = ${SRC}`));
    const { r } = await runGenerated(code, ["r"]);
    const ok = r("hello", 0);
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.val).toEqual({ w: "hello" });
      expect(ok.next).toBe(5);
    }
    // `hello_world`: o|_ is not a boundary -> trailing \b fails.
    expect(r("hello_world", 0).success).toBe(false);
    // `hello!`: !|end is a boundary -> matches "hello".
    const bang = r("hello!", 0);
    expect(bang.success).toBe(true);
    if (bang.success) expect(bang.next).toBe(5);
  });

  it('generated parser: @"lit" in a sequence returns its own text', async () => {
    const { code } = generateTypeScriptParser(
      grammarFromSource('s = @"ab" "c"'),
    );
    const { s } = await runGenerated(code, ["s"]);
    const ok = s("abc", 0);
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.val).toEqual(["ab", "c"]);
    }
  });

  it("base and optimized generators emit equivalent parsers", async () => {
    const grammar = grammarFromSource(`r = ${SRC}\ns = @"ab" "c"`);
    const base = generateTypeScriptParser(grammar);
    const opt = generateOptimizedTypeScriptParser(grammar);
    const bp = await runGenerated(base.code, ["r", "s"]);
    const op = await runGenerated(opt.code, ["r", "s"]);
    for (const input of ["hello", "hello!", "x hello", "a b", "abc", "abbc"]) {
      for (const name of ["r", "s"] as const) {
        const b = bp[name](input, 0);
        const o = op[name](input, 0);
        expect(o.success).toBe(b.success);
        if (b.success && o.success) {
          expect(o.next).toBe(b.next);
          expect(o.val).toEqual(b.val);
        }
      }
    }
  });
});

describe("reference interpreter parity", () => {
  it("Span and WordBoundary recognize exactly like generated code", async () => {
    const grammar = grammarFromSource(
      'start = \\b w:@[a-z]+ \\b\ns = @"ab" "c"',
    );
    const interp = makeReferenceInterpreter(grammar);
    const { code } = generateTypeScriptParser(grammar);
    const { start } = await runGenerated(code, ["start"]);
    // The interpreter evaluates the grammar's `start` rule.
    for (const input of ["hello", "hello!", "hello_world", "a b", "xyz"]) {
      const ir = interp(input);
      const gr = start(input, 0);
      expect(ir.ok).toBe(gr.success);
      if (ir.ok && gr.success) {
        expect(ir.next).toBe(gr.next);
      }
    }
  });
});

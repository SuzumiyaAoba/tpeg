import { describe, expect, test } from "vite-plus/test";
import type { GrammarDefinition } from "@suzumiyaaoba/tpeg-core";
import { makeReferenceInterpreter } from "./reference-interpreter";

const lit = (value: string) =>
  ({ type: "StringLiteral", value, quote: '"' }) as const;

const grammar = (
  rules: readonly { name: string; value: string }[],
  annotations: readonly { key: string; value: string }[] = [],
): GrammarDefinition => ({
  type: "GrammarDefinition",
  name: "g",
  annotations: annotations.map((a) => ({
    type: "GrammarAnnotation",
    key: a.key,
    value: a.value,
  })),
  rules: rules.map((r) => ({
    type: "RuleDefinition",
    name: r.name,
    pattern: lit(r.value),
  })),
});

describe("makeReferenceInterpreter entry-rule resolution", () => {
  test('enters through rules[0] when no rule is literally named "start"', () => {
    // The code generators resolve the entry point via `resolveStartRule`
    // (`@start`-named rule, else rules[0]); an oracle that only looks up
    // the literal name "start" would reject this perfectly valid
    // grammar instead of recognizing through `entry`.
    const interp = makeReferenceInterpreter(
      grammar([
        { name: "entry", value: "a" },
        { name: "other", value: "b" },
      ]),
    );
    expect(interp("a")).toEqual({ ok: true, next: 1 });
    expect(interp("b")).toEqual({ ok: false, fatal: false });
  });

  test('@start annotation selects the named rule, not a rule literally named "start"', () => {
    // Worst-case divergence the literal-name lookup used to produce:
    // codegen enters through `entry` (the @start target) while the
    // oracle entered through `start` -- silently comparing the
    // generated parser against a different grammar.
    const interp = makeReferenceInterpreter(
      grammar(
        [
          { name: "entry", value: "a" },
          { name: "start", value: "b" },
        ],
        [{ key: "start", value: "entry" }],
      ),
    );
    expect(interp("a")).toEqual({ ok: true, next: 1 });
    expect(interp("b")).toEqual({ ok: false, fatal: false });
  });

  test("throws when @start names a rule the grammar does not declare", () => {
    expect(() =>
      makeReferenceInterpreter(
        grammar(
          [{ name: "entry", value: "a" }],
          [{ key: "start", value: "missing" }],
        ),
      ),
    ).toThrow(/no entry rule/);
  });

  test("throws for a grammar with no rules at all", () => {
    expect(() => makeReferenceInterpreter(grammar([]))).toThrow(
      /no entry rule/,
    );
  });
});

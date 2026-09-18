/**
 * Tests for `validateGrammarForEtaGenerator` -- the thin wrapper around
 * `tpeg-parser`'s `validateGrammar` + `assertNoNullableRepetition` (see
 * that module's doc comment for why this delegates rather than keeping a
 * third copy of the checks). These tests pin the categories the Eta
 * generator must reject and, most importantly, the non-quadratic
 * behavior the previous hand-duplicated implementations lacked.
 */

import { describe, expect, it } from "vite-plus/test";
import type {
  GrammarDefinition,
  Identifier,
  RuleDefinition,
  StringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import { validateGrammarForEtaGenerator } from "./grammar-validation";

const stringLiteral = (value: string): StringLiteral => ({
  type: "StringLiteral",
  value,
  quote: '"',
});
const identifier = (name: string): Identifier => ({
  type: "Identifier",
  name,
});
const rule = (
  name: string,
  pattern: RuleDefinition["pattern"],
): RuleDefinition => ({
  type: "RuleDefinition",
  name,
  pattern,
});
const grammar = (rules: RuleDefinition[]): GrammarDefinition => ({
  type: "GrammarDefinition",
  name: "Test",
  annotations: [],
  rules,
});

describe("validateGrammarForEtaGenerator", () => {
  it("rejects a directly left-recursive rule", () => {
    const g = grammar([
      rule("start", {
        type: "Choice",
        alternatives: [
          {
            type: "Sequence",
            elements: [identifier("start"), stringLiteral("a")],
          },
          stringLiteral("b"),
        ],
      }),
    ]);

    expect(() => validateGrammarForEtaGenerator(g)).toThrow(/left-recursive/i);
  });

  it("rejects duplicate rule names", () => {
    const g = grammar([
      rule("start", stringLiteral("a")),
      rule("start", stringLiteral("b")),
    ]);

    expect(() => validateGrammarForEtaGenerator(g)).toThrow(/duplicate rule/i);
  });

  it("rejects an unbounded repetition over a nullable body", () => {
    const g = grammar([
      rule("start", {
        type: "Star",
        expression: { type: "Optional", expression: stringLiteral("a") },
      }),
    ]);

    expect(() => validateGrammarForEtaGenerator(g)).toThrow(
      /unbounded repetition/i,
    );
  });

  it("rejects a cut-only rule body", () => {
    const g = grammar([rule("start", { type: "Cut" })]);

    expect(() => validateGrammarForEtaGenerator(g)).toThrow(
      /cannot be a rule body/i,
    );
  });

  it("does not reject a bare Identifier naming an external parser (escape hatch)", () => {
    const g = grammar([rule("start", identifier("externalParser"))]);

    expect(() => validateGrammarForEtaGenerator(g)).not.toThrow();
  });

  // Regression: the hand-duplicated `findLeftRecursiveRules` /
  // `computeNullableRules` this module used to carry ran a fresh
  // per-rule reachability DFS / full-rescan fixpoint -- O(rules x edges)
  // on a long reference chain, paid unconditionally by every
  // `generateEtaTypeScriptParser` call. The delegated `tpeg-parser`
  // implementations are linear-time; a 50,000-rule chain must validate
  // quickly AND be accepted (a chain is not a cycle).
  it("a long non-recursive reference chain is validated in linear time", () => {
    const chainLength = 50_000;
    const rules: RuleDefinition[] = [];
    for (let i = 0; i < chainLength; i++) {
      rules.push(rule(`r${i}`, identifier(`r${i + 1}`)));
    }
    rules.push(rule(`r${chainLength}`, stringLiteral("z")));
    const g = grammar(rules);

    expect(() => validateGrammarForEtaGenerator(g)).not.toThrow();
  });

  // Same regression for the cycle direction: a long chain CLOSED into a
  // loop must still be reported as left-recursive, not hang or miss it.
  it("a long reference chain closed into a cycle is still rejected", () => {
    const chainLength = 20_000;
    const rules: RuleDefinition[] = [];
    for (let i = 0; i < chainLength; i++) {
      rules.push(rule(`r${i}`, identifier(`r${i + 1}`)));
    }
    rules.push(rule(`r${chainLength}`, identifier("r0")));
    const g = grammar(rules);

    expect(() => validateGrammarForEtaGenerator(g)).toThrow(/left-recursive/i);
  });
});

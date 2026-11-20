import { describe, expect, it } from "vite-plus/test";
import * as core from "@suzumiyaaoba/tpeg-core";
import * as combinator from "@suzumiyaaoba/tpeg-combinator";
import type {
  GrammarDefinition,
  Identifier,
  RuleDefinition,
  StringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import {
  compileStart,
  generateOptimizedTypeScriptParser,
  generateTypeScriptParser,
  grammarDefinition,
  prepareGrammarForGeneration,
} from "@suzumiyaaoba/tpeg-parser";
import { generateEtaTypeScriptParser } from "./eta-generator";

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

describe("grammar validation before code generation", () => {
  it.each([
    ["base", generateTypeScriptParser],
    ["optimized", generateOptimizedTypeScriptParser],
    ["Eta", generateEtaTypeScriptParser],
  ] as const)(
    "%s accepts a self reference inside {0}",
    async (_name, generate) => {
      const parsed = core.parse(grammarDefinition)(
        'grammar G { start = start{0} "a" }',
      );
      if (!parsed.success) throw new Error(parsed.error.message);
      const { code } = await generate(parsed.val, {
        includeImports: false,
        includeTypes: false,
      });
      const parse = core.parse(compileStart(code, core, combinator));
      expect(parse("a")).toMatchObject({
        success: true,
        next: 1,
        val: [[], "a"],
      });
      expect(parse("b")).toMatchObject({ success: false, error: { pos: 0 } });
    },
  );

  it("rejects a directly left-recursive rule", async () => {
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

    await expect(generateEtaTypeScriptParser(g)).rejects.toThrow(
      /left-recursive/i,
    );
  });

  it("rejects duplicate rule names", async () => {
    const g = grammar([
      rule("start", stringLiteral("a")),
      rule("start", stringLiteral("b")),
    ]);

    await expect(generateEtaTypeScriptParser(g)).rejects.toThrow(
      /duplicate rule/i,
    );
  });

  it("rejects an unbounded repetition over a nullable body", async () => {
    const g = grammar([
      rule("start", {
        type: "Star",
        expression: { type: "Optional", expression: stringLiteral("a") },
      }),
    ]);

    await expect(generateEtaTypeScriptParser(g)).rejects.toThrow(
      /unbounded repetition/i,
    );
  });

  it("rejects a cut-only rule body", async () => {
    const g = grammar([rule("start", { type: "Cut" })]);

    await expect(generateEtaTypeScriptParser(g)).rejects.toThrow(
      /cannot be a rule body/i,
    );
  });

  it("does not reject a bare Identifier naming an external parser (escape hatch)", async () => {
    const g = grammar([rule("start", identifier("externalParser"))]);

    await expect(generateEtaTypeScriptParser(g)).resolves.toMatchObject({
      exports: ["start"],
    });
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

    expect(() => prepareGrammarForGeneration(g)).not.toThrow();
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

    expect(() => prepareGrammarForGeneration(g)).toThrow(/left-recursive/i);
  });
});

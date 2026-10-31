import {
  forEachExpression,
  type Expression,
  type GrammarDefinition,
} from "@suzumiyaaoba/tpeg-core";
import {
  analyzeFirstSets,
  applySkipDesugar,
  assertNoNullableRepetition,
  collectTopLevelLabels,
  resolveStartRule,
  validateGrammar,
} from "@suzumiyaaoba/tpeg-parser";

/** A target-independent instruction tree; native backends embed it as data. */
export interface PortableNode {
  kind: Expression["type"];
  children: number[];
  text: string;
  ranges: [number, number][];
  min: number;
  max: number;
  flag: boolean;
}

export interface PortableGrammar {
  nodes: PortableNode[];
  rules: { name: string; node: number; memoize: boolean; memoLimit: number }[];
  start: string;
}

export function portableGrammar(grammar: GrammarDefinition): PortableGrammar {
  validateGrammar(grammar);
  assertNoNullableRepetition(grammar, analyzeFirstSets(grammar));
  const names = new Set(grammar.rules.map((rule) => rule.name));
  for (const rule of grammar.rules) {
    forEachExpression(rule.pattern, (expr) => {
      if (
        expr.type === "Quantified" &&
        (!Number.isSafeInteger(expr.min) ||
          expr.min < 0 ||
          (expr.max !== undefined &&
            expr.max !== Infinity &&
            (!Number.isSafeInteger(expr.max) || expr.max < expr.min)))
      )
        throw new Error(`Invalid quantified repetition in rule "${rule.name}"`);
      if (
        expr.type === "CharacterClass" &&
        expr.ranges.some(
          (range) =>
            Array.from(range.start).length !== 1 ||
            Array.from(range.end ?? range.start).length !== 1 ||
            range.start.codePointAt(0)! >
              (range.end ?? range.start).codePointAt(0)!,
        )
      )
        throw new Error(`Invalid character range in rule "${rule.name}"`);
      if (
        expr.type === "QualifiedIdentifier" ||
        (expr.type === "Identifier" && !names.has(expr.name))
      ) {
        throw new Error(
          `Rule "${rule.name}" has an unresolved reference; resolve grammar modules before generating a native parser`,
        );
      }
      if (expr.type === "ActionExpression") {
        throw new Error(
          "Inline actions contain TypeScript/JavaScript. Use a target-language transform or a native parser's transform callback instead.",
        );
      }
    });
  }

  const nodes: PortableNode[] = [];
  function emit(expr: Expression): number {
    const node: PortableNode = {
      kind: expr.type,
      children: [],
      text: "",
      ranges: [],
      min: 0,
      max: -1,
      flag: false,
    };
    switch (expr.type) {
      case "StringLiteral":
        node.text = expr.value;
        break;
      case "CharacterClass":
        node.ranges = expr.ranges.map((range) => [
          range.start.codePointAt(0)!,
          (range.end ?? range.start).codePointAt(0)!,
        ]);
        node.flag = expr.negated;
        break;
      case "Identifier":
        node.text = expr.name;
        break;
      case "LabeledExpression":
        node.text = expr.label;
        node.children = [emit(expr.expression)];
        break;
      case "Sequence": {
        node.children = expr.elements.map(emit);
        node.flag = collectTopLevelLabels(expr).length > 0;
        // Sequence(cut, x) and @skip's boundary wrappers preserve x's
        // scalar value; an actual multi-element sequence returns a tuple.
        node.min = expr.elements.filter(
          (element) => element.type !== "Cut" && element.type !== "Skip",
        ).length;
        break;
      }
      case "Choice":
        node.children = expr.alternatives.map(emit);
        break;
      case "Star":
      case "Plus":
      case "Quantified":
        node.children = [emit(expr.expression)];
        node.min =
          expr.type === "Plus" ? 1 : expr.type === "Quantified" ? expr.min : 0;
        node.max =
          expr.type === "Quantified" &&
          expr.max !== undefined &&
          expr.max !== Infinity
            ? expr.max
            : -1;
        break;
      case "Group":
      case "Optional":
      case "PositiveLookahead":
      case "NegativeLookahead":
      case "Span":
      case "Skip":
        node.children = [emit(expr.expression)];
        break;
      case "WordBoundary":
        node.flag = expr.negated;
        break;
      case "Cut":
      case "AnyChar":
        break;
      case "ActionExpression":
      case "QualifiedIdentifier":
        throw new Error(`Unsupported portable expression: ${expr.type}`);
    }
    nodes.push(node);
    return nodes.length - 1;
  }
  const normalized = applySkipDesugar(grammar);
  const start = resolveStartRule(grammar);
  if (start === null)
    throw new Error("Cannot generate a parser from an empty grammar");
  return {
    nodes,
    rules: normalized.rules.map((rule) => {
      const annotation = rule.annotations?.find(
        (annotation) => annotation.key === "memoize",
      );
      const capacity = annotation?.value ? Number(annotation.value) : Infinity;
      if (
        capacity !== Infinity &&
        (!Number.isSafeInteger(capacity) || capacity < 0)
      )
        throw new Error(`Invalid memoize capacity for rule "${rule.name}"`);
      return {
        name: rule.name,
        node: emit(rule.pattern),
        memoize: annotation !== undefined && capacity !== 0,
        memoLimit: capacity === Infinity ? -1 : capacity,
      };
    }),
    start: start.rule.name,
  };
}

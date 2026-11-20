import {
  analyzeSequenceValues,
  compileCharRange,
  quantifiedRangeError,
  type RuleDefinition,
  type Expression,
  type GrammarDefinition,
} from "@suzumiyaaoba/tpeg-core";
import {
  findMemoizeAnnotation,
  memoizeCapacity,
  prepareGrammarForGeneration,
  resolveStartRule,
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

function compileRule(
  rule: RuleDefinition,
  names: ReadonlySet<string>,
  nodes: PortableNode[],
): PortableGrammar["rules"][number] {
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
        node.ranges = expr.ranges.map(({ start, end }) => {
          const { lo, hi } = compileCharRange(start, end);
          return [lo, hi];
        });
        node.flag = expr.negated;
        break;
      case "Identifier":
      case "QualifiedIdentifier":
        if (expr.type === "QualifiedIdentifier" || !names.has(expr.name)) {
          throw new Error(
            `Rule "${rule.name}" has an unresolved reference; resolve grammar modules before generating a native parser`,
          );
        }
        node.text = expr.name;
        break;
      case "LabeledExpression":
        node.text = expr.label;
        node.children = [emit(expr.expression)];
        break;
      case "Sequence": {
        const { hasLabels, valueCount } = analyzeSequenceValues(expr);
        node.children = expr.elements.map(emit);
        node.flag = hasLabels;
        // Sequence(cut, x) and @skip's boundary wrappers preserve x's
        // scalar value; an actual multi-element sequence returns a tuple.
        node.min = valueCount;
        break;
      }
      case "Choice":
        node.children = expr.alternatives.map(emit);
        break;
      case "Star":
      case "Plus":
        node.children = [emit(expr.expression)];
        node.min = expr.type === "Plus" ? 1 : 0;
        break;
      case "Quantified": {
        const error = quantifiedRangeError(expr.min, expr.max);
        if (error)
          throw new Error(
            `Invalid quantified repetition in rule "${rule.name}": ${error}`,
          );
        node.children = [emit(expr.expression)];
        node.min = expr.min;
        node.max =
          expr.max === undefined || expr.max === Infinity ? -1 : expr.max;
        break;
      }
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
        throw new Error(
          "Inline actions contain TypeScript/JavaScript. Use a target-language transform or a native parser's transform callback instead.",
        );
    }
    nodes.push(node);
    return nodes.length - 1;
  }
  const annotation = findMemoizeAnnotation(rule);
  const capacity = annotation ? memoizeCapacity(annotation) : Infinity;
  return {
    name: rule.name,
    node: emit(rule.pattern),
    memoize: annotation !== undefined && capacity !== 0,
    memoLimit: capacity === Infinity ? -1 : capacity,
  };
}

export function portableGrammar(source: GrammarDefinition): PortableGrammar {
  const { grammar } = prepareGrammarForGeneration(source);
  const start = resolveStartRule(grammar);
  if (start === null)
    throw new Error("Cannot generate a parser from an empty grammar");
  const names = new Set(grammar.rules.map((rule) => rule.name));
  const nodes: PortableNode[] = [];
  const rules = grammar.rules.map((rule) => compileRule(rule, names, nodes));
  return { nodes, rules, start: start.rule.name };
}

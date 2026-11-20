import {
  collectInvokedRuleReferences,
  isZeroRepetition,
  selectTransformSets,
} from "@suzumiyaaoba/tpeg-core";
import type { Expression, GrammarDefinition } from "./types";

/** Possible outcomes of a failed match, as seen by the enclosing choice. */
interface FailureModes {
  readonly nonFatal: boolean;
  readonly fatal: boolean;
}

const NO_FAILURE: FailureModes = { nonFatal: false, fatal: false };
const NONFATAL_FAILURE: FailureModes = { nonFatal: true, fatal: false };

/** An external parser can backtrack or commit. An enclosing choice absorbs its cut. */
const EXTERNAL_RULE_MODES: FailureModes = { nonFatal: true, fatal: true };

const unionFailureModes = (a: FailureModes, b: FailureModes): FailureModes => ({
  nonFatal: a.nonFatal || b.nonFatal,
  fatal: a.fatal || b.fatal,
});

/** `m` with every mode forced through a `commit(...)` boundary. */
const committed = (m: FailureModes): FailureModes => ({
  nonFatal: false,
  fatal: m.nonFatal || m.fatal,
});

/** Optional matches turn an ordinary failure into a success at the original offset. */
const fatalOnly = (m: FailureModes): FailureModes => ({
  nonFatal: false,
  fatal: m.fatal,
});

/**
 * Mirror the runtime combinators. Every element is considered capable of
 * succeeding, so an absent failure mode is a proof and a present one is
 * only a possibility. Resource aborts always escape and cannot backtrack.
 */
const expressionFailureModes = (
  expr: Expression,
  ruleModes: ReadonlyMap<string, FailureModes>,
): FailureModes => {
  switch (expr.type) {
    case "StringLiteral":
      return expr.value === "" ? NO_FAILURE : NONFATAL_FAILURE;
    case "CharacterClass":
    case "AnyChar":
    case "WordBoundary":
    case "NegativeLookahead":
      return NONFATAL_FAILURE;
    case "QualifiedIdentifier":
      return EXTERNAL_RULE_MODES;
    case "Identifier":
      return ruleModes.get(expr.name) ?? EXTERNAL_RULE_MODES;
    case "Cut":
      return NO_FAILURE;
    case "PositiveLookahead": {
      const inner = expressionFailureModes(expr.expression, ruleModes);
      return inner.nonFatal || inner.fatal ? NONFATAL_FAILURE : NO_FAILURE;
    }
    case "Skip": // ignore(optional(skipRule))
    case "Optional":
    case "Star":
      return fatalOnly(expressionFailureModes(expr.expression, ruleModes));
    case "Plus":
      return expressionFailureModes(expr.expression, ruleModes);
    case "Quantified":
      if (isZeroRepetition(expr)) return NO_FAILURE;
      return expr.min === 0
        ? fatalOnly(expressionFailureModes(expr.expression, ruleModes))
        : expressionFailureModes(expr.expression, ruleModes);
    case "Group":
    case "LabeledExpression":
    case "ActionExpression":
    case "Span":
      return expressionFailureModes(expr.expression, ruleModes);
    case "Sequence": {
      let modes = NO_FAILURE;
      let pastCut = false;
      for (const el of expr.elements) {
        if (el.type === "Cut") {
          pastCut = true;
          continue;
        }
        const elModes = expressionFailureModes(el, ruleModes);
        modes = unionFailureModes(
          modes,
          pastCut ? committed(elModes) : elModes,
        );
      }
      return modes;
    }
    case "Choice":
      for (const alternative of expr.alternatives) {
        const modes = expressionFailureModes(alternative, ruleModes);
        // A reachable cut can make the choice fail ordinarily. An infallible
        // alternative ends the choice if no preceding branch could commit.
        if (modes.fatal) return NONFATAL_FAILURE;
        if (!modes.nonFatal) return NO_FAILURE;
      }
      return NONFATAL_FAILURE;
    default: {
      const exhaustiveCheck: never = expr;
      throw new Error(
        `Unhandled expression type: ${(exhaustiveCheck as { type: string }).type}`,
      );
    }
  }
};

/**
 * Compute rule outcomes once and reuse them when inspecting expressions.
 * Each bit can only be added. Recheck callers when the set of possible
 * failures grows, including callers in recursive rule groups.
 */
export function analyzeFailureModes(
  grammar: GrammarDefinition,
): (expr: Expression) => FailureModes {
  const modes = new Map<string, FailureModes>(
    grammar.rules.map((r) => [r.name, NO_FAILURE]),
  );
  // A transform can reject a successful match, even for a nullable rule.
  for (const set of selectTransformSets(grammar).values()) {
    for (const fn of set.functions) modes.set(fn.name, NONFATAL_FAILURE);
  }
  const dependents = new Map<string, number[]>();
  for (const [i, rule] of grammar.rules.entries()) {
    for (const name of collectInvokedRuleReferences(rule.pattern)) {
      const list = dependents.get(name);
      if (list) {
        list.push(i);
      } else {
        dependents.set(name, [i]);
      }
    }
  }

  const queue: number[] = grammar.rules.map((_, i) => i);
  const inQueue = new Set<number>(queue);
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++] as number;
    inQueue.delete(i);
    const rule = grammar.rules[i] as (typeof grammar.rules)[number];
    const prev = modes.get(rule.name) as FailureModes;
    const next = unionFailureModes(
      prev,
      expressionFailureModes(rule.pattern, modes),
    );
    if (next.nonFatal === prev.nonFatal && next.fatal === prev.fatal) {
      continue;
    }
    modes.set(rule.name, next);
    for (const dependent of dependents.get(rule.name) ?? []) {
      if (!inQueue.has(dependent)) {
        inQueue.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return (expr) => expressionFailureModes(expr, modes);
}

import { unwrapToLabeledExpression } from "./expression-traversal";
import { isZeroRepetition } from "./grammar-guards";
import type {
  Expression,
  GrammarDefinition,
  Sequence,
  TransformSet,
} from "./grammar-nodes";
import { walkExpression } from "./grammar-traversal";

/** Each target uses its first transform set in declaration order. */
export function selectTransformSets(
  grammar: Pick<GrammarDefinition, "transforms">,
): ReadonlyMap<string, TransformSet> {
  const sets = new Map<string, TransformSet>();
  for (const { transformSet } of grammar.transforms ?? []) {
    if (!sets.has(transformSet.targetLanguage))
      sets.set(transformSet.targetLanguage, transformSet);
  }
  return sets;
}

/** Direct labels form a capture object. Cuts and inserted skips contribute no values. */
export function analyzeSequenceValues(sequence: Sequence): {
  hasLabels: boolean;
  valueCount: number;
  hasSkip: boolean;
} {
  let hasLabels = false;
  let hasSkip = false;
  let valueCount = 0;
  for (const element of sequence.elements) {
    if (element.type === "Cut") continue;
    if (element.type === "Skip") {
      hasSkip = true;
    } else {
      valueCount++;
      hasLabels ||= unwrapToLabeledExpression(element) !== undefined;
    }
  }
  return { hasLabels, valueCount, hasSkip };
}

/** Counts expression occurrences and their maximum depth, with root depth 0. */
export const measureExpression = (
  expression: Expression,
): { depth: number; nodeCount: number } => {
  let depth = 0;
  let nodeCount = 0;
  walkExpression(expression, (_node, currentDepth) => {
    nodeCount++;
    depth = Math.max(depth, currentDepth);
  });
  return { depth, nodeCount };
};

function ruleReferences(
  expression: Expression,
  invokedOnly: boolean,
): Set<string> {
  const references = new Set<string>();
  walkExpression(expression, (node) => {
    if (node.type === "Identifier") references.add(node.name);
    return !invokedOnly || !isZeroRepetition(node);
  });
  return references;
}

/** Unqualified rule names in first-occurrence order, including references inside {0}. */
export const collectRuleReferences = (expression: Expression): Set<string> =>
  ruleReferences(expression, false);

/** Potential runtime dependencies. A {0} body contributes no calls. */
export const collectInvokedRuleReferences = (
  expression: Expression,
): Set<string> => ruleReferences(expression, true);

/**
 * Finds rules that belong to a reference cycle, in graph insertion order.
 * Merely reaching a cycle does not make a rule recursive. References outside
 * the graph have no outgoing edges and cannot participate in a cycle.
 */
export function findRecursiveRuleNames(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const recursive = new Set<string>();
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const sccStack: string[] = [];
  let nextIndex = 0;

  for (const root of dependencies.keys()) {
    if (index.has(root)) continue;
    // Iterative DFS: each work entry carries a node plus the iterator
    // over its successors, so the post-order lowlink merge into the
    // parent happens exactly when a node's frame completes.
    index.set(root, nextIndex);
    lowlink.set(root, nextIndex);
    nextIndex++;
    sccStack.push(root);
    onStack.add(root);
    const work: { node: string; it: Iterator<string> }[] = [
      {
        node: root,
        it: dependencies.get(root)?.values() ?? [][Symbol.iterator](),
      },
    ];

    while (work.length > 0) {
      const frame = work[work.length - 1] as {
        node: string;
        it: Iterator<string>;
      };
      const step = frame.it.next();
      if (step.done) {
        work.pop();
        const node = frame.node;
        const parentFrame = work[work.length - 1];
        if (parentFrame) {
          // Tree edge parent -> node: fold node's lowlink into parent's.
          lowlink.set(
            parentFrame.node,
            Math.min(
              lowlink.get(parentFrame.node) as number,
              lowlink.get(node) as number,
            ),
          );
        }
        if (lowlink.get(node) === index.get(node)) {
          // `node` is an SCC root: everything above it on `sccStack` is
          // its component.
          const scc: string[] = [];
          for (;;) {
            const member = sccStack.pop() as string;
            onStack.delete(member);
            scc.push(member);
            if (member === node) break;
          }
          if (scc.length > 1) {
            for (const member of scc) recursive.add(member);
          } else if ((dependencies.get(node) as Set<string>).has(node)) {
            // Singleton component: recursive only via a self-loop.
            recursive.add(node);
          }
        }
        continue;
      }
      const succ = step.value;
      if (!dependencies.has(succ)) continue; // unresolvable: a dead end
      if (!index.has(succ)) {
        index.set(succ, nextIndex);
        lowlink.set(succ, nextIndex);
        nextIndex++;
        sccStack.push(succ);
        onStack.add(succ);
        work.push({
          node: succ,
          it: dependencies.get(succ)?.values() ?? [][Symbol.iterator](),
        });
      } else if (onStack.has(succ)) {
        // Back/cross edge to a node still on the SCC stack.
        lowlink.set(
          frame.node,
          Math.min(
            lowlink.get(frame.node) as number,
            index.get(succ) as number,
          ),
        );
      }
    }
  }
  return new Set(
    [...dependencies.keys()].filter((name) => recursive.has(name)),
  );
}

const labelOf = (expr: Expression): string | undefined =>
  unwrapToLabeledExpression(expr)?.label;

/**
 * Collects the label names directly visible on an expression: either the
 * expression itself is a (possibly grouped) `LabeledExpression`, or - if
 * it's a `Sequence` - each of its immediate elements that is one, or - if
 * it's a `Choice` - the union of whatever's visible on each alternative
 * (only one alternative ever actually runs, so `captureChoice`/`choice`
 * pass its own captured object through unchanged; absent labels are read
 * as `undefined` by the action wrapper - see `docs/peg-grammar.md`'s "Capture
 * Inference" section, `choice = a:first / b:second -> captures: {a?: T1,
 * b?: T2}"). This mirrors the runtime merge performed by
 * `captureSequence`/`mergeCaptures` (`@suzumiyaaoba/tpeg-core`'s
 * `capture.ts`), which merges each direct child's captured object into one
 * - so these names describe the directly visible captures. Fields nested
 * under repetition are accessed through $$ instead of bare variables.
 *
 * `Group` is unwrapped before either check (it's transparent at codegen
 * time - see `labelOf`), so a parenthesized `(a:"x" b:"y")` or
 * `(a:"x" / b:"y")` is recognized exactly like its unparenthesized form.
 */
const collectActionLabels = (
  expr: Expression,
  requiredOnly: boolean,
): string[] => {
  let visible: Set<string> | undefined;
  walkExpression(expr, (node) => {
    // Choices combine associatively. Visit each alternative through any
    // intervening groups, preserving the first occurrence order of labels.
    if (
      node.type === "Group" ||
      (node.type === "Choice" && node.alternatives.length > 0)
    ) {
      return true;
    }
    const labels = new Set<string>();
    if (node.type === "Sequence") {
      node.elements.forEach((element) => {
        const label = labelOf(element);
        if (label !== undefined) labels.add(label);
      });
    } else if (node.type === "LabeledExpression") {
      labels.add(node.label);
    }

    if (!visible) visible = labels;
    else if (requiredOnly) {
      for (const label of visible) {
        if (!labels.has(label)) visible.delete(label);
      }
    } else {
      for (const label of labels) visible.add(label);
    }
    // A sequence exposes its direct labels only. Repetitions, actions
    // and other expressions are boundaries for bare action variables.
    return false;
  });
  return [...(visible ?? [])];
};

/** Names visible to an action, including labels absent on some alternatives. */
export const collectTopLevelLabels = (expr: Expression): string[] =>
  collectActionLabels(expr, false);

/** Labels present as own fields on every successful alternative. */
export const collectRequiredTopLevelLabels = (expr: Expression): string[] =>
  collectActionLabels(expr, true);

import { unwrapToLabeledExpression } from "./expression-traversal";
import type { Expression } from "./grammar-nodes";
import { walkExpression } from "./grammar-traversal";

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

/**
 * Collects unqualified rule references in first-occurrence order.
 * Qualified identifiers refer to external modules, not this grammar's rules.
 */
export const collectRuleReferences = (expression: Expression): Set<string> => {
  const references = new Set<string>();
  walkExpression(expression, (node) => {
    if (node.type === "Identifier") references.add(node.name);
  });
  return references;
};

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
 * pass its own captured object through unchanged; a caller destructuring
 * the union just gets `undefined` for whichever labels the OTHER
 * alternatives would have bound - see `docs/peg-grammar.md`'s "Capture
 * Inference" section, `choice = a:first / b:second -> captures: {a?: T1,
 * b?: T2}"). This mirrors the runtime merge performed by
 * `captureSequence`/`mergeCaptures` (`@suzumiyaaoba/tpeg-core`'s
 * `capture.ts`), which merges each direct child's captured object into one
 * - so the label set computed here always matches the keys actually
 * present on the merged value at runtime.
 *
 * `Group` is unwrapped before either check (it's transparent at codegen
 * time - see `labelOf`), so a parenthesized `(a:"x" b:"y")` or
 * `(a:"x" / b:"y")` is recognized exactly like its unparenthesized form.
 */
export const collectTopLevelLabels = (expr: Expression): string[] => {
  const unwrapped = expr.type === "Group" ? expr.expression : expr;
  if (unwrapped.type === "Sequence") {
    // Deduplicated via a `Set`, same as the `Choice` branch below --
    // two elements of one `Sequence` reusing the same label name (e.g.
    // `a:"x" a:"y"`) merge into a SINGLE `a` key at runtime
    // (`mergeCaptures`'s `Object.assign`, last write wins), so a caller
    // destructuring `$$` only ever sees one `a` binding to declare. This
    // function's own doc comment promises the label set returned here
    // "always matches the keys actually present on the merged value at
    // runtime" -- without dedup, `wrapWithAction` (below) emitted
    // `const { a, a } = $$;`, a duplicate-binding `SyntaxError` in the
    // generated file, for every rule whose action reused a label name.
    return [
      ...new Set(
        unwrapped.elements
          .map(labelOf)
          .filter((label): label is string => label !== undefined),
      ),
    ];
  }
  if (unwrapped.type === "Choice") {
    const seen = new Set<string>();
    for (const alt of unwrapped.alternatives) {
      for (const label of collectTopLevelLabels(alt)) seen.add(label);
    }
    return [...seen];
  }
  const single = labelOf(unwrapped);
  return single !== undefined ? [single] : [];
};

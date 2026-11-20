import { describe, expect, it } from "vite-plus/test";
import {
  type Expression,
  createGroup,
  createLabeledExpression,
  createSequence,
  createStringLiteral,
} from "./grammar-types";
import {
  forEachExpression,
  someExpression,
  unwrapToLabeledExpression,
} from "./expression-traversal";

const literal = (value: string) => createStringLiteral(value, '"');
function deepGroups(leaf: Expression, count = 20_000): Expression {
  let expression = leaf;
  for (let index = 0; index < count; index++)
    expression = createGroup(expression);
  return expression;
}

describe("expression traversal boundaries", () => {
  it("forEach respects a supplied child iterator", () => {
    const a = literal("a");
    const b = literal("b");
    const children: Expression[] = [a, b];
    children[Symbol.iterator] = function* () {
      yield b;
      yield a;
      return undefined;
    };
    const root = createSequence(children);
    const visits: Expression[] = [];
    forEachExpression(root, (node) => visits.push(node));
    expect(visits).toEqual([root, b, a]);
  });

  it("forEach reads custom iterators even when a child array's length is zero", () => {
    const leaf = literal("a");
    const innerChildren: Expression[] = [];
    Object.defineProperty(innerChildren, Symbol.iterator, {
      value: function* () {
        yield leaf;
      },
    });
    const inner = createSequence(innerChildren);
    const outerChildren: Expression[] = [];
    Object.defineProperty(outerChildren, Symbol.iterator, {
      value: function* () {
        yield inner;
      },
    });
    const root = createSequence(outerChildren);
    const visits: Expression[] = [];
    forEachExpression(root, (node) => visits.push(node));
    expect(visits).toEqual([root, inner, leaf]);
  });

  it("closes active child iterators after a callback throws", () => {
    let closed = 0;
    const children: Expression[] = [literal("a")];
    children[Symbol.iterator] = function* () {
      try {
        yield* Array.prototype.values.call(this);
      } finally {
        closed++;
      }
      return undefined;
    };
    const root = createSequence(children);
    expect(() =>
      forEachExpression(root, (node) => {
        if (node !== root) throw new Error("callback");
      }),
    ).toThrow("callback");
    expect(closed).toBe(1);
  });

  it("closes every parent iterator and preserves a descendant's original error", () => {
    const failure = new Error("node type");
    const broken = Object.defineProperty(literal("a"), "type", {
      get() {
        throw failure;
      },
    });
    const innerChildren: Expression[] = [broken];
    const inner = createSequence(innerChildren);
    const outerChildren: Expression[] = [inner];
    const closed: string[] = [];
    Object.defineProperty(innerChildren, Symbol.iterator, {
      value: function* () {
        try {
          yield broken;
        } finally {
          closed.push("inner");
          // Deliberately failing cleanup must not replace the descendant error.
          // eslint-disable-next-line no-unsafe-finally
          throw new Error("cleanup");
        }
      },
    });
    Object.defineProperty(outerChildren, Symbol.iterator, {
      value: function* () {
        try {
          yield inner;
        } finally {
          closed.push("outer");
        }
      },
    });
    expect(() =>
      forEachExpression(
        deepGroups(createSequence(outerChildren), 100),
        () => {},
      ),
    ).toThrow(failure);
    expect(closed).toEqual(["inner", "outer"]);
  });

  it("visits every node of a deep tree without using the call stack", () => {
    const leaf = literal("a");
    let count = 0;
    let last: Expression | undefined;
    forEachExpression(deepGroups(leaf), (node) => {
      count++;
      last = node;
    });
    expect(count).toBe(20_001);
    expect(last).toBe(leaf);
  });

  it("finds a deep descendant without overflowing", () => {
    const leaf = literal("a");
    expect(someExpression(deepGroups(leaf), (node) => node === leaf)).toBe(
      true,
    );
    expect(someExpression(deepGroups(leaf), () => false)).toBe(false);
  });

  it("unwraps deep groups to the original labeled node", () => {
    const labeled = createLabeledExpression("value", literal("a"));
    expect(unwrapToLabeledExpression(deepGroups(labeled))).toBe(labeled);
    expect(unwrapToLabeledExpression(deepGroups(literal("a")))).toBeUndefined();
  });

  it("visits repeated shared subtrees in preorder at every occurrence", () => {
    const leaf = literal("a");
    const shared = createGroup(leaf);
    const root = createSequence([shared, shared]);
    const visits: Expression[] = [];
    forEachExpression(root, (node) => visits.push(node));
    expect(visits).toEqual([root, shared, leaf, shared, leaf]);
  });

  it("reads later children after earlier callbacks have finished", () => {
    const first = literal("a");
    const original = literal("b");
    const replacement = literal("c");
    let later = original;
    const children: Expression[] = [first, original];
    Object.defineProperty(children, "1", { get: () => later });
    const root = createSequence(children);
    const visits: Expression[] = [];
    forEachExpression(root, (node) => {
      visits.push(node);
      if (node === first) later = replacement;
    });
    expect(visits).toEqual([root, first, replacement]);
  });

  it("does not read unused siblings after a match", () => {
    const first = literal("a");
    const children: Expression[] = [first, literal("b")];
    Object.defineProperty(children, "1", {
      get() {
        throw new Error("unused sibling");
      },
    });
    expect(
      someExpression(createSequence(children), (node) => node === first),
    ).toBe(true);
  });

  it("does not inspect children when the root matches", () => {
    const root = createGroup(literal("a"));
    Object.defineProperty(root, "expression", {
      get() {
        throw new Error("unused child");
      },
    });
    expect(someExpression(root, () => true)).toBe(true);
  });

  it("forEach follows child additions while some keeps its initial length", () => {
    for (const walk of ["all", "some"] as const) {
      const first = literal("a");
      const added = literal("b");
      const root = createSequence([first]);
      const visits: Expression[] = [];
      const visit = (node: Expression) => {
        visits.push(node);
        if (node === first) root.elements.push(added);
        return false;
      };
      if (walk === "all") forEachExpression(root, visit);
      else someExpression(root, visit);
      expect(visits).toEqual(
        walk === "all" ? [root, first, added] : [root, first],
      );
    }
  });

  it("some skips missing children as Array.some does", () => {
    const leaf = literal("a");
    const children: Expression[] = [leaf];
    children.length = 3;
    const root = createSequence(children);
    const visits: Expression[] = [];
    expect(
      someExpression(root, (node) => {
        visits.push(node);
        return false;
      }),
    ).toBe(false);
    expect(visits).toEqual([root, leaf]);
  });

  it("rejects cycles without confusing them with shared subtrees", () => {
    const cyclic = createGroup(literal("a"));
    cyclic.expression = cyclic;
    for (const walk of [
      () => forEachExpression(cyclic, () => {}),
      () => someExpression(cyclic, () => false),
      () => unwrapToLabeledExpression(cyclic),
    ]) {
      expect(walk).toThrow(/Cyclic expression AST/);
    }
    expect(someExpression(cyclic, () => true)).toBe(true);
  });
});

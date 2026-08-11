import { describe, expect, it } from "bun:test";
import {
  ASCII_TABLE_SIZE,
  type DispatchTrieEntry,
  buildDispatchTrie,
  walkDispatchTrie,
} from "./dispatch-trie";
import type { Parser } from "./types";

/**
 * `dispatch-trie.ts` had no direct spec before this file -- only indirect
 * coverage through `predictiveChoice` (`./combinators.spec.ts`'s "literal-
 * prefix trie (third tuple slot)" describe block). These tests exercise
 * `buildDispatchTrie`/`walkDispatchTrie` in isolation, at the unit the
 * doc comments on this module actually describe, so a bug here doesn't
 * need a whole grammar/dispatch-table round trip to surface.
 */

// A stand-in parser identity -- these tests only ever check WHICH parser
// instance ends up in a candidate list, never actually invoke one.
const stubParser = (label: string): Parser<string> => {
  const p: Parser<string> = (input, pos) => ({
    success: true,
    val: label,
    current: pos,
    next: pos,
  });
  return p;
};

const entry = (
  label: string,
  index: number,
  remaining: string,
): DispatchTrieEntry<string> => ({
  parser: stubParser(label),
  index,
  remaining,
});

const labelsOf = (parsers: readonly Parser<string>[]): string[] =>
  parsers
    .map((p) => (p as unknown as Parser<string>)("", 0))
    .map((r) => {
      if (!r.success) throw new Error("stub parser never fails");
      return r.val;
    });

describe("ASCII_TABLE_SIZE", () => {
  it("is 128 -- one entry per ASCII code unit, matching predictiveChoice's asciiTable", () => {
    expect(ASCII_TABLE_SIZE).toBe(128);
  });
});

describe("buildDispatchTrie", () => {
  it("stops at the root with children: null when fewer than two entries have a remaining literal character", () => {
    // A single prefixed entry: nothing to discriminate against, so no
    // trie should be built at all -- see the function's own doc comment
    // ("the 'candidates >= 2 AND prefixed >= 2' condition below").
    const node = buildDispatchTrie([entry("only", 0, "bc")]);
    expect(node.children).toBeNull();
    expect(labelsOf(node.candidates)).toEqual(["only"]);
  });

  it("stops at the root with children: null when every entry has an empty remaining (no literal info at all)", () => {
    const node = buildDispatchTrie([
      entry("a", 0, ""),
      entry("b", 1, ""),
      entry("c", 2, ""),
    ]);
    expect(node.children).toBeNull();
    expect(labelsOf(node.candidates)).toEqual(["a", "b", "c"]);
  });

  it("builds one child level when two or more entries share a discriminable next character", () => {
    // "if" / "in" -- both start 'i', diverge at their second character.
    const node = buildDispatchTrie([entry("if", 0, "f"), entry("in", 1, "n")]);
    expect(node.children).not.toBeNull();
    expect(node.children?.size).toBe(2);

    const fChild = node.children?.get("f".charCodeAt(0));
    const nChild = node.children?.get("n".charCodeAt(0));
    expect(fChild).toBeDefined();
    expect(nChild).toBeDefined();
    // Each child's own remaining is now "" (fully consumed) -- a single
    // entry per child, so no further descent.
    expect(fChild?.children).toBeNull();
    expect(labelsOf(fChild?.candidates ?? [])).toEqual(["if"]);
    expect(nChild?.children).toBeNull();
    expect(labelsOf(nChild?.candidates ?? [])).toEqual(["in"]);
  });

  it("stops descending PER LEVEL, not just at the root, once fewer than two entries remain discriminable at that depth", () => {
    // "if" / "import" / "interface" / "instanceof" share "i", diverge at
    // "f" vs "n"; the "n" group then further shares "in" between "import"
    // and {"interface","instanceof"}, but "import" itself has no sibling
    // at the "im"/"in" split ('m' is unique to it) -- so descent must stop
    // there for "import" specifically while continuing for the
    // interface/instanceof pair.
    const node = buildDispatchTrie([
      entry("if", 0, "f"),
      entry("import", 1, "nport"),
      entry("interface", 2, "nterface"),
      entry("instanceof", 3, "nstanceof"),
    ]);
    // Root: 'f' and 'n' children.
    expect(node.children?.size).toBe(2);
    const nChild = node.children?.get("n".charCodeAt(0));
    expect(nChild).toBeDefined();
    // At depth 2 ("in..."), "import" has remaining "port", "interface" has
    // "terface", "instanceof" has "stanceof" -- all three still have
    // remaining characters but diverge immediately ('p' vs 't' vs 's'),
    // so this level DOES build one more child layer, each with exactly
    // one candidate (children: null at THAT depth).
    expect(nChild?.children?.size).toBe(3);
    const pChild = nChild?.children?.get("p".charCodeAt(0));
    expect(pChild?.children).toBeNull();
    expect(labelsOf(pChild?.candidates ?? [])).toEqual(["import"]);
  });

  it("splices a remaining === '' entry into EVERY child group unconditionally, like a wildcard", () => {
    // Mirrors what `combinators.ts`'s `remaining: filter && literalPrefix
    // ? literalPrefix.slice(1) : ""` does for a null-filter alternative --
    // an entry with no literal information left must never be excludable
    // by depth alone.
    const node = buildDispatchTrie([
      entry("if", 0, "f"),
      entry("in", 1, "n"),
      entry("wildcard", 2, ""),
    ]);
    expect(node.children?.size).toBe(2);
    const fChild = node.children?.get("f".charCodeAt(0));
    const nChild = node.children?.get("n".charCodeAt(0));
    // Both children see the wildcard alongside their own discriminated
    // entry.
    expect(labelsOf(fChild?.candidates ?? [])).toEqual(["if", "wildcard"]);
    expect(labelsOf(nChild?.candidates ?? [])).toEqual(["in", "wildcard"]);
  });

  it("candidates are in ascending original declaration order and deduplicated by index", () => {
    // Declaration order is 2, 0, 1 here (out of order on purpose) -- the
    // result must still read 0, 1, 2: ordered-choice's "first match wins"
    // depends on this.
    const node = buildDispatchTrie([
      entry("third", 2, ""),
      entry("first", 0, ""),
      entry("second", 1, ""),
    ]);
    expect(labelsOf(node.candidates)).toEqual(["first", "second", "third"]);
  });

  it("deduplicates an entry reachable via more than one path (e.g. propagated wildcard plus its own bucket) by index", () => {
    // An entry that is BOTH a same-bucket sibling (via its own remaining)
    // and separately spliced in as a wildcard at a shallower level would,
    // without dedup, appear twice in `candidates` -- verified directly at
    // the `dispatchTrieCandidates` level by constructing entries that
    // collide on `index`.
    const node = buildDispatchTrie([
      entry("dup", 0, "x"),
      entry("dup", 0, ""), // same index, reached a second way
      entry("other", 1, "y"),
    ]);
    expect(labelsOf(node.candidates)).toEqual(["dup", "other"]);
  });
});

describe("walkDispatchTrie", () => {
  it("descends as far as the input matches a known child, returning that node's candidates", () => {
    // `remaining` here already has the shared first character ('i')
    // stripped -- exactly like `predictiveChoice`'s own construction
    // (`remaining: literalPrefix.slice(1)`), since the ASCII bucket
    // itself already accounted for that character. `walkDispatchTrie` is
    // therefore called starting at `pos` pointing at the SECOND
    // character, matching that same call site.
    const node = buildDispatchTrie([entry("if", 0, "f"), entry("in", 1, "n")]);
    expect(labelsOf(walkDispatchTrie(node, "if", 1))).toEqual(["if"]);
    expect(labelsOf(walkDispatchTrie(node, "in", 1))).toEqual(["in"]);
  });

  it("stops at the current node's candidates the instant the next character has no matching child", () => {
    const node = buildDispatchTrie([
      entry("if", 0, "f"),
      entry("import", 1, "mport"),
    ]);
    // "ix": at depth 0 (this function is called with `pos` already past
    // the first character, matching predictiveChoice's own call site),
    // 'x' has no child -- falls back to the root's own candidates
    // (both "if" and "import", since this node's `remaining` split
    // happened on the SECOND character of each -- 'f' vs 'm' -- and 'x'
    // matches neither).
    expect(labelsOf(walkDispatchTrie(node, "ix", 1))).toEqual(["if", "import"]);
  });

  it("stops at end of input (charCodeAt returns NaN, matching no child) without throwing", () => {
    const node = buildDispatchTrie([
      entry("if", 0, "f"),
      entry("import", 1, "mport"),
    ]);
    // pos === input.length: charCodeAt(pos) is NaN, which was never
    // inserted as a Map key, so Map.get simply misses and the walk stops
    // cleanly at the root.
    expect(() => walkDispatchTrie(node, "i", 1)).not.toThrow();
    expect(labelsOf(walkDispatchTrie(node, "i", 1))).toEqual(["if", "import"]);
  });

  it("walks multiple levels deep when the input keeps matching", () => {
    const node = buildDispatchTrie([
      entry("import", 0, "mport"),
      entry("interface", 1, "nterface"),
      entry("instanceof", 2, "nstanceof"),
    ]);
    // "instant": after 'i' (consumed by the caller before this function is
    // invoked, per predictiveChoice's own call site), walks 'n' -> 's' ->
    // 't' -> ... descending through "instanceof"'s branch until "instant"
    // diverges from it (at "instantceof" vs "instant", position 5:
    // 'c' vs whatever comes next) or runs out of trie depth, and returns
    // whatever node it stops at.
    const result = walkDispatchTrie(node, "instant", 1);
    // Whatever node this lands on, "instanceof" must be among its
    // candidates (it's the only alternative sharing "instan..." this
    // deep) and "import"/"interface" must not have survived the 'n'/'t'
    // split against 'm'/'e'.
    expect(labelsOf(result)).toEqual(["instanceof"]);
  });

  it("stays at the root (single non-null level) when the shared prefix is exactly two entries deep and no further", () => {
    const node = buildDispatchTrie([entry("if", 0, "f"), entry("in", 1, "n")]);
    expect(node.children).not.toBeNull();
    // Walking from a node with `children: null` (already fully
    // discriminated) is a no-op that just returns its own candidates.
    const ifChild = node.children?.get("f".charCodeAt(0));
    expect(ifChild).toBeDefined();
    if (ifChild) {
      expect(labelsOf(walkDispatchTrie(ifChild, "anything", 5))).toEqual([
        "if",
      ]);
    }
  });
});

import type { Parser } from "./types";

/** The dispatch table only ever covers ASCII code UNITS (0-127), which
 * coincide 1:1 with ASCII code POINTS -- ASCII is a subset of both
 * encodings by definition, so a table entry can be looked up straight
 * from `input.charCodeAt(offset)` with no `codePointAt` decoding needed
 * for that fast path. Every code point at or above this is handled by the
 * non-ASCII fallback in `predictiveChoice` (`./combinators.ts`). */
export const ASCII_TABLE_SIZE = 128;

/**
 * One node of the literal-prefix dispatch trie `predictiveChoice`
 * (`./combinators.ts`) builds per ASCII first-character bucket: extends
 * FIRST_1 dispatch past a single character for
 * alternatives that share a longer literal prefix (e.g. `if`/`import`/
 * `interface`/`instanceof` all starting with `i`), without requiring a
 * fixed lookahead depth the way a FIRST_2/FIRST_3 table would.
 *
 * `candidates` is the CORRECT surviving-candidate list for this exact
 * node -- every alternative reachable at this depth, in ascending original
 * declaration order, deduplicated -- so a caller that cannot (or need not)
 * descend further (no `children`, or the next character has no matching
 * child) can use it directly, exactly like today's flat `asciiTable`
 * entry. `children` is `null` when fewer than two of this node's entries
 * still have an undiscriminated literal character left (see
 * {@link buildDispatchTrie}) -- descending further couldn't narrow
 * anything, so there is nothing to build.
 */
export interface DispatchTrieNode<T> {
  readonly candidates: readonly Parser<T>[];
  readonly children: ReadonlyMap<number, DispatchTrieNode<T>> | null;
}

/** One alternative's state while building a {@link DispatchTrieNode}:
 * `remaining` is the still-unconsumed suffix of its known literal prefix
 * (empty for an alternative with no literal prefix, OR one whose prefix
 * has been fully consumed by the depth already reached -- both cases mean
 * "no more static information to discriminate this one further," so it
 * must propagate into every child unconditionally, like a wildcard). */
export interface DispatchTrieEntry<T> {
  readonly parser: Parser<T>;
  readonly index: number;
  readonly remaining: string;
}

/** Every distinct alternative reachable in `entries`, in ascending
 * original declaration order (never re-sorted by anything else -- ordered
 * choice's "first match wins" semantics depend on this), deduplicated by
 * index (the same alternative can reach one node via more than one path,
 * e.g. as both a same-bucket sibling and a propagated wildcard). */
const dispatchTrieCandidates = <T>(
  entries: readonly DispatchTrieEntry<T>[],
): readonly Parser<T>[] => {
  const seen = new Set<number>();
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const candidates: Parser<T>[] = [];
  for (const entry of sorted) {
    if (seen.has(entry.index)) continue;
    seen.add(entry.index);
    candidates.push(entry.parser);
  }
  return candidates;
};

/**
 * Builds one {@link DispatchTrieNode} from `entries` (every alternative
 * already known to survive up to this depth), recursively. Stops
 * descending (returns `children: null`) once fewer than two entries still
 * have an unconsumed literal character to discriminate on -- a single
 * remaining candidate needs no further narrowing, and this deliberately
 * does NOT build a depth-1 node just to hold one entry: the "candidates >=
 * 2 AND prefixed >= 2" condition below is enforced at every level, not
 * just the root.
 *
 * An entry with `remaining === ""` (no literal information left, whether
 * it started that way or was exhausted at a shallower depth) is spliced
 * into EVERY child group unconditionally -- it can never be excluded by
 * depth alone, exactly like a `null`-filter alternative in the existing
 * ASCII table is never excluded by first character alone.
 */
export const buildDispatchTrie = <T>(
  entries: readonly DispatchTrieEntry<T>[],
): DispatchTrieNode<T> => {
  const withRemaining = entries.filter((e) => e.remaining.length > 0);
  if (withRemaining.length < 2) {
    return { candidates: dispatchTrieCandidates(entries), children: null };
  }

  const exhausted = entries.filter((e) => e.remaining.length === 0);
  const groups = new Map<number, DispatchTrieEntry<T>[]>();
  for (const entry of withRemaining) {
    const code = entry.remaining.charCodeAt(0);
    const advanced: DispatchTrieEntry<T> = {
      ...entry,
      remaining: entry.remaining.slice(1),
    };
    const group = groups.get(code);
    if (group) {
      group.push(advanced);
    } else {
      groups.set(code, [advanced]);
    }
  }

  const children = new Map<number, DispatchTrieNode<T>>();
  for (const [code, group] of groups) {
    children.set(code, buildDispatchTrie([...group, ...exhausted]));
  }
  return { candidates: dispatchTrieCandidates(entries), children };
};

/** Descends `node` as far as `input` (starting at `pos`) matches a known
 * child, returning whichever node's `candidates` it stops at -- the
 * current node's own list the instant the next character has no matching
 * child (including at end of input, where `charCodeAt` returns `NaN`,
 * which -- never having been inserted as a key -- simply fails every
 * `Map.get`). Iterative, not recursive: this runs on every predictive
 * dispatch into a trie-bearing bucket, not just at construction time. */
export const walkDispatchTrie = <T>(
  node: DispatchTrieNode<T>,
  input: string,
  pos: number,
): readonly Parser<T>[] => {
  let current = node;
  let offset = pos;
  while (current.children) {
    const child = current.children.get(input.charCodeAt(offset));
    if (!child) break;
    current = child;
    offset++;
  }
  return current.candidates;
};

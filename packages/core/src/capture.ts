/**
 * TPEG Capture Combinators
 *
 * Implements capture functionality for labeled expressions.
 * Captures allow parsers to return structured data with named fields
 * instead of just arrays or raw values.
 */

import { tryOrderedCandidates } from "./combinators";
import { IGNORED } from "./ignored";
import type { Parser } from "./types";
import { createFailure, isFailure, isValidOffset } from "./utils";

/**
 * Captured value type represents a structured object with labeled fields
 */
export type CapturedValue = { [key: string]: unknown };

/**
 * Result type for captured parsers
 */
export type CaptureResult<T> = T extends CapturedValue ? T : never;

/**
 * Non-enumerable marker distinguishing an object `capture(...)` itself
 * produced from an arbitrary object-shaped VALUE that merely happens to
 * flow through an unlabeled `Sequence` element -- e.g. an unlabeled
 * reference to another rule whose OWN pattern uses labels internally
 * (`pair = key:Ident "=" value:Ident`) produces an object (`{key, value}`)
 * with no capture() of its own at the referencing site. Without this tag,
 * `mergeCaptures`/`captureSequence` (below) can't tell that object apart
 * from a genuine same-level capture and would flatten its fields into the
 * caller's result -- silently leaking an unrelated rule's internal field
 * names into whichever grammar rule happens to reference it unlabeled.
 * `enumerable: false` keeps it out of `Object.keys`/a spread/`JSON.stringify`
 * of the captured value itself; `Object.assign` (which `mergeCaptures` uses
 * to build the merged result) also only copies OWN ENUMERABLE properties,
 * so the tag never propagates onto a `mergeCaptures` merge's own output --
 * intentional, so that an unlabeled reference to a `captureSequence` rule
 * (no `capture(...)` of its own) is excluded from a further outer merge
 * exactly the same way.
 */
const CAPTURE_TAG = Symbol("tpeg.capture");

/** `true` iff `value` is an object `capture(...)` produced (directly, not
 * merely something object-shaped that flowed through unlabeled) -- see
 * `CAPTURE_TAG`'s doc comment. */
const isCaptureTagged = (value: unknown): value is CapturedValue =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as Record<PropertyKey, unknown>)[CAPTURE_TAG] === true;

/**
 * Creates a capture parser that labels a value with a given name.
 *
 * @template T The type of value to capture
 * @param label The label name for the captured value
 * @param parser The parser to capture the result from
 * @returns Parser that returns an object with the labeled captured value
 *
 * @example
 * ```typescript
 * const nameParser = capture("name", literal("hello"));
 * const result = nameParser("hello", 0);
 * // result.val = { name: "hello" }
 * ```
 */
export const capture = <T, L extends string>(
  label: L,
  parser: Parser<T>,
): Parser<{ [K in L]: T }> => {
  return (input: string, pos: number) => {
    const result = parser(input, pos);

    if (isFailure(result)) {
      return result;
    }

    const capturedValue = { [label]: result.val } as { [K in L]: T };
    Object.defineProperty(capturedValue, CAPTURE_TAG, {
      value: true,
      enumerable: false,
    });

    return {
      success: true as const,
      val: capturedValue,
      current: result.current,
      next: result.next,
    };
  };
};

/**
 * Merges multiple captured objects into a single object.
 * Used internally by the sequence combinator when dealing with labeled expressions.
 *
 * Only merges entries `capture(...)` itself produced (see `CAPTURE_TAG`'s doc
 * comment) -- an entry that merely happens to be object-shaped (e.g. an
 * unlabeled reference to another rule that uses labels internally) is
 * skipped, exactly like a non-object entry (a plain string/array/etc. from
 * an unlabeled literal) already was. Without this, that unrelated rule's
 * own field names would silently leak into the merged result.
 *
 * @param captures Array of values to merge (only `capture(...)`-tagged ones
 *   actually contribute fields)
 * @returns Merged object containing every tagged capture's fields
 *
 * @example
 * ```typescript
 * const merged = mergeCaptures([
 *   capture("name", literal("hello"))("hello", 0).val,
 *   capture("value", literal("world"))("world", 0).val,
 * ]);
 * // merged = { name: "hello", value: "world" }
 * ```
 */
export const mergeCaptures = (captures: unknown[]): CapturedValue => {
  const result: CapturedValue = {};

  for (const capture of captures) {
    if (!isCaptureTagged(capture)) continue;
    // Copy entries with defineProperty rather than `Object.assign`: a
    // label named `__proto__` is a legal grammar label, and assign's
    // `[[Set]]` semantics route it through `Object.prototype`'s
    // `__proto__` setter -- silently dropping a primitive value or
    // replacing the merged object's prototype with an object value.
    // Defining a plain data property keeps it an ordinary own property
    // (the same thing `capture(...)`'s own computed-key literal
    // `{ [label]: ... }` already produces upstream).
    for (const key of Reflect.ownKeys(capture)) {
      const descriptor = Object.getOwnPropertyDescriptor(capture, key);
      if (!descriptor?.enumerable) continue;
      Object.defineProperty(result, key, {
        value: (capture as Record<PropertyKey, unknown>)[key],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }

  return result;
};

/**
 * Creates a sequence parser that merges captured values into a single object.
 * If all elements are captured (labeled), returns a merged object.
 * If some elements are not captured, returns a mixed array/object.
 *
 * @template P Array of parsers
 * @param parsers Array of parsers, some of which may return captured values
 * @returns Parser that returns merged captures or a tuple
 *
 * @example
 * ```typescript
 * const parser = captureSequence(
 *   capture("name", literal("hello")),
 *   capture("value", literal("world"))
 * );
 * const result = parser("helloworld", 0);
 * // result.val = { name: "hello", value: "world" }
 * ```
 */
export const captureSequence = <P extends Parser<unknown>[]>(
  ...parsers: P
): Parser<
  CapturedValue | { [K in keyof P]: P[K] extends Parser<infer T> ? T : never }
> => {
  return (input: string, pos: number) => {
    // Same out-of-contract-`pos` guard `sequence` applies
    // (`./combinators.ts`): an invalid offset must fail here rather than
    // fall into the zero-element branch below and echo itself back as a
    // bogus zero-width success. `pos === input.length` stays legal.
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Expected a valid position", pos, {
        parserName: "captureSequence",
      });
    }

    if (parsers.length === 0) {
      return {
        success: true as const,
        val: {} as CapturedValue,
        current: pos,
        next: pos,
      };
    }

    const results: unknown[] = [];
    let currentPos = pos;
    let hasCaptures = false;

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      if (!parser) {
        return createFailure(`Parser at index ${i} is undefined`, pos, {
          parserName: "captureSequence",
        });
      }

      const result = parser(input, currentPos);
      if (isFailure(result)) {
        return result;
      }

      // `ignore(...)` results consume input but contribute no value
      // (see `IGNORED`'s doc comment); skipping the push also keeps them
      // out of the `hasCaptures` check and the merge below.
      if (result.val !== IGNORED) {
        results.push(result.val);
      }
      currentPos = result.next;

      // Only a `capture(...)`-tagged result makes this a genuine capture
      // -- see `CAPTURE_TAG`'s doc comment for why an incidentally
      // object-shaped but untagged result (e.g. an unlabeled reference to
      // another rule that uses labels internally) must NOT flip this.
      if (isCaptureTagged(result.val)) {
        hasCaptures = true;
      }
    }

    // If we have captures, merge them into a single object
    if (hasCaptures) {
      const merged = mergeCaptures(results);
      return {
        success: true as const,
        val: merged,
        current: pos,
        next: currentPos,
      };
    }

    // Otherwise, return as a regular sequence tuple
    return {
      success: true as const,
      val: results as {
        [K in keyof P]: P[K] extends Parser<infer T> ? T : never;
      },
      current: pos,
      next: currentPos,
    };
  };
};

/**
 * Creates a choice parser that preserves capture structure.
 * When alternatives have different capture labels, the result will contain
 * optional fields for each possible capture.
 *
 * @template T Union type of all possible parser results
 * @param parsers Array of alternative parsers
 * @returns Parser that returns the result of the first successful alternative
 *
 * @example
 * ```typescript
 * const parser = captureChoice(
 *   capture("name", literal("hello")),
 *   capture("value", literal("world"))
 * );
 * const result1 = parser("hello", 0);
 * // result1.val = { name: "hello" }
 * const result2 = parser("world", 0);
 * // result2.val = { value: "world" }
 * ```
 */
export const captureChoice = <T extends unknown[]>(
  ...parsers: { [K in keyof T]: Parser<T[K]> }
): Parser<T[number]> => {
  // Delegates entirely to `tryOrderedCandidates` (`./combinators.ts`,
  // shared with `choice`/`predictiveChoice`) rather than keeping its own
  // copy of the cut-absorption and farthest-failure logic: an independent
  // copy here duplicated the exact same fatal-swap subtlety `choice` has
  // (see that function's doc comment) AND its own farthest-error
  // tracking (`longestError`, which read `result.error.pos` on every
  // failing candidate -- exactly the per-failure materialization the
  // lazy watermark in `./failure.ts` eliminates for `choice` by routing
  // through the shared, singleton-aware helper instead). Left as an
  // independent copy, capture-heavy grammars (which is most
  // TPEG-generated code, since `captureSequence`/`captureChoice` are what
  // codegen emits for labeled rules) would have silently defeated that
  // watermark's whole point.
  const candidates = parsers as unknown as readonly Parser<T[number]>[];
  return (input: string, pos: number) =>
    tryOrderedCandidates(candidates, input, pos, "captureChoice");
};

/**
 * Wraps a parser so a `CAPTURE_TAG`ged object in its successful result is
 * replaced by a shallow copy WITHOUT the tag -- the tag is non-enumerable,
 * so a plain enumerable spread drops it while keeping every labeled field.
 *
 * Generated code applies this at every RULE boundary (each `export const
 * <rule>`): per `docs/peg-grammar.md`'s Capture Structure Reference, a rule
 * referenced unlabeled must contribute NOTHING to an enclosing
 * `captureSequence`'s merge. That invariant breaks when a rule's own
 * top-level parser still returns a tagged object -- e.g. `pair = key:"a"`
 * compiles to a bare `capture("key", ...)`, and `(x:"a")`, `x:"a" / y:"b"`,
 * `x:"a"?`, or an action body that `return`s `$$` can all surface a tagged
 * value the same way. Normalizing at the boundary (rather than trying to
 * enumerate every emitting shape) keeps the rule's own value identical --
 * the tag is invisible to user code either way -- while making an
 * unlabeled reference behave exactly like an unlabeled literal does.
 *
 * Applied INSIDE any `memoize(...)` wrapper the generator adds, so the
 * memo table caches the already-untagged object rather than re-copying it
 * on every cache hit.
 */
export const untagCapture = <T>(parser: Parser<T>): Parser<T> => {
  return (input: string, pos: number) => {
    const result = parser(input, pos);
    if (!result.success || !isCaptureTagged(result.val)) return result;
    return {
      success: true as const,
      val: { ...(result.val as CapturedValue) } as T,
      current: result.current,
      next: result.next,
    };
  };
};

/**
 * Checks if a value is a captured value (object with string keys).
 *
 * @param value The value to check
 * @returns True if the value is a captured value
 */
export const isCapturedValue = (value: unknown): value is CapturedValue => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

/**
 * Extracts capture labels from a captured value.
 *
 * @param value The captured value
 * @returns Array of capture labels
 */
export const getCaptureLabels = (value: CapturedValue): string[] => {
  return Object.keys(value);
};

/**
 * Gets a captured value by label.
 *
 * @param value The captured value object
 * @param label The label to retrieve
 * @returns The captured value for the given label
 */
export const getCapturedValue = <T>(
  value: CapturedValue,
  label: string,
): T | undefined => {
  return value[label] as T | undefined;
};

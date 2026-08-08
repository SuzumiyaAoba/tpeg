/**
 * TPEG Capture Combinators
 *
 * Implements capture functionality for labeled expressions.
 * Captures allow parsers to return structured data with named fields
 * instead of just arrays or raw values.
 */

import { tryOrderedCandidates } from "./combinators";
import type { Parser } from "./types";
import { createFailure, isFailure } from "./utils";

/**
 * Captured value type represents a structured object with labeled fields
 */
export type CapturedValue = { [key: string]: unknown };

/**
 * Result type for captured parsers
 */
export type CaptureResult<T> = T extends CapturedValue ? T : never;

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
 * @param captures Array of captured objects to merge
 * @returns Merged object containing all captures
 *
 * @example
 * ```typescript
 * const merged = mergeCaptures([{ name: "hello" }, { value: 42 }]);
 * // merged = { name: "hello", value: 42 }
 * ```
 */
export const mergeCaptures = (captures: unknown[]): CapturedValue => {
  const result: CapturedValue = {};

  for (const capture of captures) {
    if (capture && typeof capture === "object" && !Array.isArray(capture)) {
      Object.assign(result, capture);
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

      results.push(result.val);
      currentPos = result.next;

      // Check if this result is a captured value (object with string keys)
      if (
        result.val &&
        typeof result.val === "object" &&
        !Array.isArray(result.val)
      ) {
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

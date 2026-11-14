import {
  cloneParseError,
  createFailure,
  getCharAt,
  guardedParserCall,
  isValidOffset,
  mergeFailureWatermark,
  resetFailureWatermark,
  restoreFailureWatermark,
  snapshotFailureWatermark,
  type FailureWatermarkSnapshot,
  type ParseError,
  type Parser,
} from "@suzumiyaaoba/tpeg-core";

export interface RecoveryContext {
  error: ParseError;
  /** Text discarded by recovery, including a consumed synchronizer. */
  skipped: string;
  start: number;
  next: number;
}

export interface RecoveryOptions<T> {
  /** A delimiter or end-of-input assertion marking the next safe boundary. */
  synchronize: Parser<unknown>;
  fallback(context: RecoveryContext): T;
  consumeSynchronizer?: boolean;
  /** Maximum UTF-16 distance to search; defaults to the rest of the input. */
  maxSkip?: number;
  onError?(error: ParseError): void;
}

/**
 * Recover an ordinary syntax failure at the next synchronization boundary.
 * The fallback must advance the input, so it is safe inside repetitions.
 * Wrapped-parser cuts and resource aborts propagate; synchronizer cuts stay local.
 * Recovered errors and failed delimiter probes do not pollute later errors.
 */
export function recover<T, R>(
  parser: Parser<T>,
  options: RecoveryOptions<R>,
): Parser<T | R> {
  if (
    options.maxSkip !== undefined &&
    (!Number.isSafeInteger(options.maxSkip) || options.maxSkip < 0)
  ) {
    throw new RangeError("maxSkip must be a non-negative safe integer");
  }
  return (input, pos) => {
    if (!isValidOffset(pos) || pos > input.length) {
      return createFailure("Invalid recovery offset", pos, {
        fatal: true,
        abort: true,
      });
    }
    const before = snapshotFailureWatermark();
    const merge = (local: FailureWatermarkSnapshot) => {
      restoreFailureWatermark(before);
      if (local.input !== null)
        mergeFailureWatermark(local.input, local.pos, local.expected);
    };
    // Recovery decisions need this parser's own failure position, never a
    // farther abandoned alternative left in the ambient diagnostic state.
    resetFailureWatermark();
    let result: ReturnType<Parser<T>>;
    try {
      result = guardedParserCall(() => parser(input, pos), pos);
    } catch (cause) {
      merge(snapshotFailureWatermark());
      throw cause;
    }
    if (result.success) {
      merge(snapshotFailureWatermark());
      return result;
    }
    const error = cloneParseError(result.error);
    const failed = snapshotFailureWatermark();
    if (error.fatal || error.abort) {
      merge(failed);
      return { success: false, error };
    }
    const end = Math.min(input.length, pos + (options.maxSkip ?? input.length));
    let cursor = Number.isSafeInteger(error.pos)
      ? Math.max(pos, Math.min(input.length, error.pos))
      : pos;

    while (cursor <= end) {
      let boundary: ReturnType<Parser<unknown>>;
      try {
        boundary = guardedParserCall(
          () => options.synchronize(input, cursor),
          cursor,
        );
      } catch (cause) {
        merge(failed);
        throw cause;
      }
      if (!boundary.success && boundary.error.abort) {
        const error = cloneParseError(boundary.error);
        merge(snapshotFailureWatermark());
        return { success: false, error };
      }
      // A cut inside the synchronizer is local to that speculative probe.
      restoreFailureWatermark(failed);
      if (boundary.success) {
        if (
          !isValidOffset(boundary.next) ||
          boundary.next > input.length ||
          boundary.next < cursor
        ) {
          merge(failed);
          return createFailure(
            "Invalid synchronization parser position",
            cursor,
            { fatal: true, abort: true },
          );
        }
        const next = options.consumeSynchronizer ? boundary.next : cursor;
        if (next > pos) {
          const context = {
            error,
            skipped: input.slice(pos, next),
            start: pos,
            next,
          };
          restoreFailureWatermark(before);
          const val = options.fallback(context);
          options.onError?.(cloneParseError(error));
          return { success: true, val, current: pos, next };
        }
        merge(failed);
        return { success: false, error };
      }
      if (cursor >= input.length) break;
      cursor += getCharAt(input, cursor).length || 1;
    }
    merge(failed);
    return { success: false, error };
  };
}

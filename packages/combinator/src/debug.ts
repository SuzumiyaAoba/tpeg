import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { safeStringForDisplay } from "@suzumiyaaoba/tpeg-core";
import { named } from "./error";

/** Read a logged payload once; failures in its display must not replace the result. */
const formatDebugValue = <T>(
  read: () => T,
  fallback: (value: T) => unknown = (value) => value,
): string => {
  let value: T;
  try {
    value = read();
  } catch {
    return "<unprintable value>";
  }

  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // A cyclic value or throwing toJSON may still have a printable fallback.
  }

  try {
    return safeStringForDisplay(fallback(value));
  } catch {
    // An error's fallback message can itself be a throwing getter.
    return "<unprintable value>";
  }
};

/**
 * Creates a debug wrapper for a parser with comprehensive logging capabilities.
 */
export const debug = <T>(
  parser: Parser<T>,
  name: string,
  options: {
    logSuccess?: boolean;
    logFailure?: boolean;
    logInput?: boolean;
    logResult?: boolean;
    customLogger?: (message: string) => void;
  } = {},
  parserName?: string,
): Parser<T> => {
  const {
    logSuccess = true,
    logFailure = true,
    logInput = false,
    logResult = false,
    customLogger = console.log,
  } = options;

  const debugParser: Parser<T> = (input: string, pos: number) => {
    if (logInput) {
      const context = input.slice(pos, pos + 20);
      customLogger(`[DEBUG ${name}] Input at ${pos}: "${context}..."`);
    }

    const result = parser(input, pos);

    if (result.success && logSuccess) {
      customLogger(`[DEBUG ${name}] SUCCESS`);
      if (logResult) {
        const valStr = formatDebugValue(() => result.val);
        customLogger(`[DEBUG ${name}] Result: ${valStr}`);
      }
    } else if (!result.success && logFailure) {
      customLogger(`[DEBUG ${name}] FAILURE`);
      if (logResult) {
        const errStr = formatDebugValue(
          () => result.error,
          (error) => error?.message ?? error,
        );
        customLogger(`[DEBUG ${name}] Error: ${errStr}`);
      }
    }

    return result;
  };

  return named(debugParser, parserName);
};

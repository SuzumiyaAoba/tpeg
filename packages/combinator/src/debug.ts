import type {
  ParseFailure,
  Parser,
  Pos,
} from "@suzumiyaaoba/tpeg-core";
import { withDetailedError } from "./error";

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

  const debugParser: Parser<T> = (input: string, pos: Pos) => {
    const startPos = pos || { offset: 0, line: 1, column: 1 };

    if (logInput) {
      const context = input.slice(startPos.offset, startPos.offset + 20);
      customLogger(
        `[DEBUG ${name}] Input at ${startPos.offset}: "${context}..."`,
      );
    }

    const result = parser(input, startPos);

    if (result.success && logSuccess) {
      customLogger(`[DEBUG ${name}] SUCCESS`);
      if (logResult) {
        const valStr = (() => {
          try {
            return JSON.stringify(result.val);
          } catch {
            return String(result.val);
          }
        })();
        customLogger(`[DEBUG ${name}] Result: ${valStr}`);
      }
    } else if (!result.success && logFailure) {
      customLogger(`[DEBUG ${name}] FAILURE`);
      if (logResult) {
        const err = (result as ParseFailure).error;
        const errStr = (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err?.message ?? err);
          }
        })();
        customLogger(`[DEBUG ${name}] Error: ${errStr}`);
      }
    }

    return result;
  };

  return parserName ? withDetailedError(debugParser, parserName) : debugParser;
};

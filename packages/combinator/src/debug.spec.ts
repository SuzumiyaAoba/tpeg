import { describe, expect, it, vi } from "vite-plus/test";
import {
  map,
  parse,
  type ParseError,
  type Parser,
} from "@suzumiyaaoba/tpeg-core";
import { literal } from "@suzumiyaaoba/tpeg-core";
import { debug } from "./debug";

describe("debug combinator", () => {
  it("uses the value obtained on the first read when JSON conversion fails", () => {
    let reads = 0;
    const original = {
      toJSON() {
        throw new Error("Cannot serialize");
      },
      toString() {
        return "original value";
      },
    };
    const result = {
      success: true as const,
      current: 0,
      next: 1,
      get val() {
        return reads++ === 0 ? original : "changed value";
      },
    };
    const logger = vi.fn();
    expect(
      debug(() => result, "Test", {
        logResult: true,
        customLogger: logger,
      })("a", 0),
    ).toBe(result);
    expect(logger).toHaveBeenCalledWith("[DEBUG Test] Result: original value");
    expect(reads).toBe(1);
  });

  it.each(["success", "failure"])(
    "keeps a %s result when its logged field getter throws",
    (kind) => {
      let reads = 0;
      const result =
        kind === "success"
          ? {
              success: true as const,
              current: 0,
              next: 1,
              get val(): unknown {
                reads++;
                throw new Error("Cannot read value");
              },
            }
          : {
              success: false as const,
              get error(): ParseError {
                reads++;
                throw new Error("Cannot read error");
              },
            };
      const logger = vi.fn();
      expect(
        debug(() => result, "Test", {
          logResult: true,
          customLogger: logger,
        })("a", 0),
      ).toBe(result);
      const label = kind === "success" ? "Result" : "Error";
      expect(logger).toHaveBeenCalledWith(
        `[DEBUG Test] ${label}: <unprintable value>`,
      );
      expect(reads).toBe(1);
    },
  );

  it("keeps a failure when both JSON conversion and its message getter throw", () => {
    const error: ParseError = Object.assign(new Error("Rejected"), { pos: 0 });
    Object.defineProperty(error, "message", {
      enumerable: true,
      get() {
        throw new Error("Cannot read message");
      },
    });
    const result = { success: false as const, error };
    const logger = vi.fn();
    expect(
      debug(() => result, "Test", {
        logResult: true,
        customLogger: logger,
      })("a", 0),
    ).toBe(result);
    expect(logger).toHaveBeenCalledWith(
      "[DEBUG Test] Error: <unprintable value>",
    );
  });

  it.each([Symbol("parsed"), () => 1])(
    "prints a value with no JSON representation: %s",
    (value) => {
      const result = {
        success: true as const,
        val: value,
        current: 0,
        next: 1,
      };
      const logger = vi.fn();
      expect(
        debug(() => result, "Test", {
          logResult: true,
          customLogger: logger,
        })("a", 0),
      ).toBe(result);
      expect(logger).toHaveBeenCalledWith(
        `[DEBUG Test] Result: ${String(value)}`,
      );
    },
  );

  it("uses a string representation when a successful value's toJSON returns undefined", () => {
    const value = {
      toJSON() {
        return undefined;
      },
      toString() {
        return "fallback value";
      },
    };
    const result = { success: true as const, val: value, current: 0, next: 1 };
    const logger = vi.fn();
    expect(
      debug(() => result, "Test", {
        logResult: true,
        customLogger: logger,
      })("a", 0),
    ).toBe(result);
    expect(logger).toHaveBeenCalledWith("[DEBUG Test] Result: fallback value");
  });

  it("uses the diagnostic message when an error's toJSON returns undefined", () => {
    const error = {
      message: "Rejected",
      pos: 0,
      toJSON() {
        return undefined;
      },
    };
    const result = { success: false as const, error };
    const logger = vi.fn();
    expect(
      debug(() => result, "Test", {
        logResult: true,
        customLogger: logger,
      })("a", 0),
    ).toBe(result);
    expect(logger).toHaveBeenCalledWith("[DEBUG Test] Error: Rejected");
  });

  it.each([
    ["success", false],
    ["failure", false],
    ["success", true],
    ["failure", true],
  ] as const)(
    "does not read the %s payload when its logging is disabled (all=%s)",
    (kind, disableAll) => {
      let reads = 0;
      const result =
        kind === "success"
          ? {
              success: true as const,
              current: 0,
              next: 1,
              get val(): unknown {
                reads++;
                throw new Error("Must not read value");
              },
            }
          : {
              success: false as const,
              get error(): ParseError {
                reads++;
                throw new Error("Must not read error");
              },
            };
      const logger = vi.fn();
      expect(
        debug(() => result, "Test", {
          logResult: disableAll,
          logSuccess: !disableAll,
          logFailure: !disableAll,
          customLogger: logger,
        })("a", 0),
      ).toBe(result);
      expect(reads).toBe(0);
      expect(logger).toHaveBeenCalledTimes(disableAll ? 0 : 1);
    },
  );

  it.each(["success", "failure"])(
    "propagates custom logger exceptions while printing a %s payload",
    (kind) => {
      const stopped = new Error("Logger stopped parsing");
      const result =
        kind === "success"
          ? { success: true as const, val: "a", current: 0, next: 1 }
          : { success: false as const, error: { message: "Rejected", pos: 0 } };
      const parser = debug(() => result, "Test", {
        logResult: true,
        customLogger(message) {
          if (message.includes("Result:") || message.includes("Error:")) {
            throw stopped;
          }
        },
      });
      expect(() => parser("a", 0)).toThrow(stopped);
    },
  );

  it("preserves the message of a cyclic diagnostic", () => {
    const error = { message: "Rejected", pos: 0, details: {} };
    error.details = error;
    const result = { success: false as const, error };
    const logger = vi.fn();
    expect(
      debug(() => result, "Test", {
        logResult: true,
        customLogger: logger,
      })("a", 0),
    ).toBe(result);
    expect(logger).toHaveBeenCalledWith("[DEBUG Test] Error: Rejected");
  });

  it("prints an undefined successful value", () => {
    const result = {
      success: true as const,
      val: undefined,
      current: 0,
      next: 1,
    };
    const logger = vi.fn();
    expect(
      debug(() => result, "Test", {
        logResult: true,
        customLogger: logger,
      })("a", 0),
    ).toBe(result);
    expect(logger).toHaveBeenCalledWith("[DEBUG Test] Result: undefined");
  });

  it("propagates exceptions raised by the wrapped parser", () => {
    const stopped = new Error("Parser stopped parsing");
    const parser = debug(
      () => {
        throw stopped;
      },
      "Test",
      { logResult: true, customLogger: vi.fn() },
    );
    expect(() => parser("a", 0)).toThrow(stopped);
  });

  it.each([
    [
      "cyclic object without a prototype",
      () => {
        const value = Object.create(null);
        value.self = value;
        return value;
      },
    ],
    [
      "throwing JSON and primitive conversions",
      () => ({
        toJSON() {
          throw new Error("Cannot serialize");
        },
        [Symbol.toPrimitive]() {
          throw new Error("Cannot print");
        },
      }),
    ],
    [
      "cyclic array with a throwing primitive conversion",
      () => {
        const value: unknown[] = [];
        value.push(value);
        Object.defineProperty(value, Symbol.toPrimitive, {
          value() {
            throw new Error("Cannot print");
          },
        });
        return value;
      },
    ],
  ])("keeps successful results when logging a %s", (_name, createValue) => {
    const value = createValue();
    const result = { success: true as const, val: value, current: 0, next: 1 };
    const parser: Parser<unknown> = () => result;
    const logger = vi.fn();
    const logged = debug(parser, "Test", {
      logResult: true,
      customLogger: logger,
    })("a", 0);
    expect(logged).toBe(result);
    expect(logger).toHaveBeenCalledWith(
      "[DEBUG Test] Result: <unprintable value>",
    );
  });

  it("does not stringify values when result logging is disabled", () => {
    const toJSON = vi.fn(() => {
      throw new Error("Not used");
    });
    const parser = debug(
      map(literal("a"), () => ({ toJSON })),
      "Test",
      { logResult: false, customLogger: vi.fn() },
    );
    expect(parser("a", 0).success).toBe(true);
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("preserves exceptions deliberately raised by the custom logger", () => {
    const error = new Error("Logger stopped parsing");
    const parser = debug(literal("a"), "Test", {
      customLogger() {
        throw error;
      },
    });
    expect(() => parser("a", 0)).toThrow(error);
  });
  it("should log success", () => {
    const logger = vi.fn(() => {});
    const parser = debug(literal("abc"), "TestParser", {
      customLogger: logger,
      logSuccess: true,
    });

    parse(parser)("abc");

    expect(logger).toHaveBeenCalled();
    const calls = logger.mock.calls as unknown[][];
    expect(calls.some((call) => String(call[0]).includes("SUCCESS"))).toBe(
      true,
    );
  });

  it("should log failure", () => {
    const logger = vi.fn(() => {});
    const parser = debug(literal("abc"), "TestParser", {
      customLogger: logger,
      logFailure: true,
    });

    parse(parser)("def");

    expect(logger).toHaveBeenCalled();
    const calls = logger.mock.calls as unknown[][];
    expect(calls.some((call) => String(call[0]).includes("FAILURE"))).toBe(
      true,
    );
  });

  it("should log input if requested", () => {
    const logger = vi.fn(() => {});
    const parser = debug(literal("abc"), "TestParser", {
      customLogger: logger,
      logInput: true,
    });

    parse(parser)("abc");

    expect(logger).toHaveBeenCalled();
    const calls = logger.mock.calls as unknown[][];
    expect(calls.some((call) => String(call[0]).includes("Input at 0"))).toBe(
      true,
    );
  });
});

import { describe, expect, it, mock } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { literal } from "@suzumiyaaoba/tpeg-core";
import { debug } from "./debug";

describe("debug combinator", () => {
  it("should log success", () => {
    const logger = mock(() => {});
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
    const logger = mock(() => {});
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
    const logger = mock(() => {});
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

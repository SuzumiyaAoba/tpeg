import { describe, expect, test } from "vite-plus/test";
import { identifier } from "@suzumiyaaoba/tpeg-parser";
import { parseExample } from "./parse-example";
import {
  runBasicDemo,
  runCompleteDemo,
  runFileDemo,
  runGrammarDemo,
} from "./index";

describe("parser-sample demo runners", () => {
  test("reports the first trailing character when a syntax example matches only a prefix", () => {
    expect(parseExample(identifier, "with-dash")).toMatchObject({
      success: false,
      error: { pos: 4, expected: "end of input" },
    });
    expect(parseExample(identifier, "with_dash")).toMatchObject({
      success: true,
      next: 9,
    });
  });
  test("runs every public demo helper from the source package", async () => {
    for (const runDemo of [
      runBasicDemo,
      runGrammarDemo,
      runFileDemo,
      runCompleteDemo,
    ]) {
      await expect(runDemo()).resolves.toBe(0);
    }
  }, 60_000);
});

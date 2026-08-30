import { describe, expect, test } from "vite-plus/test";
import {
  runBasicDemo,
  runCompleteDemo,
  runFileDemo,
  runGrammarDemo,
} from "./index";

describe("parser-sample demo runners", () => {
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

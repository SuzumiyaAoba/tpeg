import { describe, expect, it } from "bun:test";
import path from "node:path";
import { Grammar } from "./index";

describe("Grammar", () => {
  it("", async () => {
    const pegGrammar = await Bun.file(
      path.resolve(__dirname, "peg.peg"),
    ).text();

    const actual = Grammar(pegGrammar, { offset: 0, column: 0, line: 1 });

    expect(actual.success).toBe(true);
  });
});

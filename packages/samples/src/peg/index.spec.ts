import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Grammar } from "./index";

describe("Grammar", () => {
  it("", async () => {
    const pegGrammar = await Bun.file(
      path.resolve(__dirname, "peg.peg"),
    ).text();

    const actual = Grammar(pegGrammar, 0);

    expect(actual.success).toBe(true);
  });
});

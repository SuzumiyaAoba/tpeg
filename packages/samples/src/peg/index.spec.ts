import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Grammar } from "./index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Grammar", () => {
  it("", async () => {
    const pegGrammar = readFileSync(path.resolve(__dirname, "peg.peg"), "utf8");

    const actual = Grammar(pegGrammar, 0);

    expect(actual.success).toBe(true);
  });
});

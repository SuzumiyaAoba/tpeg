import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Grammar, Space, Spacing } from "./index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Grammar", () => {
  it("", async () => {
    const pegGrammar = readFileSync(path.resolve(__dirname, "peg.peg"), "utf8");

    const actual = Grammar(pegGrammar, 0);

    expect(actual.success).toBe(true);
  });
});

describe("Space", () => {
  // Regression for #57: `Space` is documented as `' ' / '\t' / EndOfLine`
  // but used `"\r"` where `"\t"` was meant -- tabs were not whitespace and
  // a bare `\r` counted twice (it is also EndOfLine's last alternative).
  it.each([" ", "\t", "\r\n", "\n", "\r"])("matches %j", (input) => {
    const result = Space(input, 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toBe(input.length);
    }
  });

  it("does not match a non-whitespace character", () => {
    expect(Space("x", 0).success).toBe(false);
  });

  it("Spacing skips a run of spaces, tabs and newlines", () => {
    const result = Spacing(" \t\n  x", 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.next).toBe(5);
    }
  });
});

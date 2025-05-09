import { describe, expect, it } from "bun:test";
import { octalDigitsToChar } from "./utils";

describe("Utility functions", () => {
  describe("octalDigitsToChar", () => {
    it("should convert octal string to character", () => {
      expect(octalDigitsToChar("101")).toBe("A"); // Octal 101 = 65 in decimal = "A"
      expect(octalDigitsToChar("142")).toBe("b"); // Octal 142 = 98 in decimal = "b"
      expect(octalDigitsToChar("40")).toBe(" "); // Octal 40 = 32 in decimal = space
    });

    it("should handle different octal values", () => {
      expect(octalDigitsToChar("0")).toBe("\0"); // Null character
      expect(octalDigitsToChar("12")).toBe("\n"); // Newline
      expect(octalDigitsToChar("11")).toBe("\t"); // Tab
    });
  });
});

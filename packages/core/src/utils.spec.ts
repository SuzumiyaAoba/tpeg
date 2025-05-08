import { describe, expect, it } from "bun:test";
import { isEmptyArray, isNonEmptyArray } from "./utils";

describe("isEmptyArray", () => {
  it("should return true for an empty array", () => {
    expect(isEmptyArray([])).toBe(true);
  });

  it("should return false for a non-empty array", () => {
    expect(isEmptyArray([1, 2, 3])).toBe(false);
  });
});

describe("isNonEmptyArray", () => {
  it("should return false for an empty array", () => {
    expect(isNonEmptyArray([])).toBe(false);
  });

  it("should return true for a non-empty array", () => {
    expect(isNonEmptyArray([1, 2, 3])).toBe(true);
  });
});

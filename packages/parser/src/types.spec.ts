import { describe, expect, it } from "vite-plus/test";
import { createCharRange, createStringLiteral } from "./types";

describe("grammar constructors exposed by the parser", () => {
  it("defaults to double quotes and preserves an explicit single quote", () => {
    expect(createStringLiteral("a").quote).toBe('"');
    expect(createStringLiteral("a", "'").quote).toBe("'");
  });

  it("createCharRange produces a single-character range without `end`", () => {
    expect(createCharRange("a")).toEqual({ start: "a" });
  });

  it("createCharRange produces a start-end range", () => {
    expect(createCharRange("a", "z")).toEqual({ start: "a", end: "z" });
  });

  it("createCharRange preserves an explicitly-passed empty-string end", () => {
    // `end ? ... : ...` dropped `end: ""` entirely, producing the same node
    // as `createCharRange("a")`; every sibling factory (here and in core)
    // distinguishes "not passed" with `!== undefined`.
    expect(createCharRange("a", "")).toEqual({ start: "a", end: "" });
  });
});

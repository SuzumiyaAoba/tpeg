import { describe, expect, it } from "vite-plus/test";
import { createCharRange as coreCreateCharRange } from "@suzumiyaaoba/tpeg-core";
import { createCharRange } from "./types";

// The factories in `./types` duplicate `packages/core/src/grammar-types.ts`'s
// for the shared AST node shapes (the types themselves are re-exported from
// core, only the constructors are local copies). Those copies have drifted
// before -- `createCharRange` kept a truthiness check after core's switched
// to `!== undefined` -- so the parity-sensitive edges get a regression test
// here rather than assuming the two stay in sync.
describe("types.ts factory parity with core", () => {
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
    expect(createCharRange("a", "")).toEqual(coreCreateCharRange("a", ""));
  });
});

import { describe, expect, it } from "vite-plus/test";
import { compileRule } from "./harness";

describe("benchmark generated-code execution", () => {
  for (const optimize of [false, true]) {
    it.each(["parse", "map", "number", "constructor", "toString", "__proto__"])(
      `compiles a rule named %s (optimize: ${optimize})`,
      (name) => {
        const compiled = compileRule(`grammar G { ${name} = "a" }`, name, {
          optimize,
        });
        expect(compiled.parser("a", 0)).toEqual({
          success: true,
          val: "a",
          current: 0,
          next: 1,
        });
        expect(compiled.leafInvocations.count).toBe(1);
      },
    );

    it.each(["constructor", "toString", "__proto__"])(
      `rejects a missing rule named %s (optimize: ${optimize})`,
      (name) => {
        expect(() =>
          compileRule('grammar G { start = "a" }', name, { optimize }),
        ).toThrow(`rule "${name}" not found`);
      },
    );

    it(`uses strict module semantics (optimize: ${optimize})`, () => {
      const compiled = compileRule(
        'grammar G { start = "a" { return this === undefined; } }',
        "start",
        { optimize },
      );
      expect(compiled.parser("a", 0)).toMatchObject({
        success: true,
        val: true,
      });
    });

    it(`does not expose the loader's arguments (optimize: ${optimize})`, () => {
      const compiled = compileRule(
        'grammar G { start = "a" { return eval("typeof arguments"); } }',
        "start",
        { optimize },
      );
      expect(compiled.parser("a", 0)).toMatchObject({
        success: true,
        val: "undefined",
      });
      expect(compiled.leafInvocations.count).toBe(1);
    });

    it(`keeps export-like template text out of the returned rule table (optimize: ${optimize})`, () => {
      const compiled = compileRule(
        'grammar G { start = "a" { return `raw\nexport const fake = 1;\nexport { fake as start };`; } }',
        "start",
        { optimize },
      );
      expect(compiled.parser("a", 0)).toMatchObject({
        success: true,
        val: "raw\nexport const fake = 1;\nexport { fake as start };",
      });
    });
  }
});

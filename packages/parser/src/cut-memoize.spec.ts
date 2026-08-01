/**
 * End-to-end tests for the `~` cut/commit operator and the `@memoize` rule
 * annotation: parse a raw `.tpeg` grammar block through `grammarDefinition`,
 * compile it with the real code generator, and run the generated parser.
 */

import { describe, expect, test } from "bun:test";
import { type Parser, parse } from "@suzumiyaaoba/tpeg-core";
import { generateTypeScriptParser } from "./codegen";
import { grammarDefinition } from "./grammar";

const testParse = <T>(parser: Parser<T>, input: string) => parse(parser)(input);

describe("`~` cut operator, parsed from grammar text", () => {
  test("commits an alternative once matched, instead of backtracking to a sibling", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");

    const source = `grammar Stmt {
      stmt = "i" ~ "f" / "i"
    }`;

    const parsed = testParse(grammarDefinition, source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = generateTypeScriptParser(parsed.val, {
      includeImports: false,
      includeTypes: false,
    });
    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      `${body}\nreturn { stmt };`,
    );
    const { stmt } = moduleFactory(...Object.values(core));

    const pos = { offset: 0, line: 1, column: 1 };
    expect(stmt("if", pos).success).toBe(true);
    // Without the cut, "ix" would fall through to the second alternative
    // and succeed by matching just "i".
    expect(stmt("ix", pos).success).toBe(false);
  });
});

describe("`@memoize` annotation, parsed from grammar text", () => {
  test("bounds the generated rule's memo table via maxCacheSize", async () => {
    const core = await import("@suzumiyaaoba/tpeg-core");
    const combinator = await import("@suzumiyaaoba/tpeg-combinator");

    const source = `grammar Bounded {
      @memoize: 4
      digits = [0-9]+
    }`;

    const parsed = testParse(grammarDefinition, source);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.val.rules[0]?.annotations).toEqual([
      { type: "GrammarAnnotation", key: "memoize", value: "4" },
    ]);

    const result = generateTypeScriptParser(parsed.val, {
      includeImports: false,
      includeTypes: false,
    });
    expect(result.code).toContain("memoize(");
    expect(result.code).toContain("maxCacheSize: 4");

    const body = result.code.replace(/^export const (\w+)/gm, "const $1");
    const moduleFactory = new Function(
      ...Object.keys(core),
      ...Object.keys(combinator),
      `${body}\nreturn { digits };`,
    );
    const { digits } = moduleFactory(
      ...Object.values(core),
      ...Object.values(combinator),
    );

    const pos = { offset: 0, line: 1, column: 1 };
    const parsedDigits = digits("12345x", pos);
    expect(parsedDigits.success).toBe(true);
    if (parsedDigits.success) {
      expect(parsedDigits.next.offset).toBe(5);
    }
  });
});

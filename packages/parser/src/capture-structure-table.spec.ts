/**
 * Regression test for docs/peg-grammar.md's Capture Structure Reference
 * Table: for every row, actually PARSE a grammar shaped like the row's
 * "Grammar Pattern" column, generate real TypeScript via
 * `generateTypeScriptParser` (`./codegen.ts`, no AST optimizations --
 * that table describes the BASE generator's shape), compile it, run it
 * against real input, and check the runtime value matches what the row
 * claims.
 *
 * Why this exists: `docs-grammar-examples.spec.ts` already checks that
 * every fenced `grammar { ... }` example in the doc PARSES, but nothing
 * previously checked that this specific table's claims about runtime
 * VALUE SHAPE stay true. That gap is exactly how the table drifted --
 * `[a-z]+` claiming a bare `string` (self-contradicting the table's own
 * `pattern+ -> T[]` row), `pattern?`/`value:pattern?` claiming
 * `T?`/`{ value?: T }` when `optional()` (packages/core/src/
 * repetition.ts) actually returns `[T] | []`, and `&pattern`/`!pattern`
 * claiming `null` when a lookahead's tuple/object slot is actually
 * `undefined` -- all four were caught this way and corrected in the doc
 * alongside this file being added. Compiling and running each row (not
 * just re-deriving its expected shape by hand) is what makes this a
 * regression test rather than a second copy of the table to keep in
 * sync by hand.
 */

import { describe, expect, test } from "bun:test";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import { generateTypeScriptParser } from "./codegen";
import { grammarDefinition } from "./grammar";

/** Mirrors `codegen-differential.spec.ts`'s `compileStart` -- generated
 * code (no imports, `includeImports: false`) has no static import
 * target, so it's compiled via `new Function` against the already-
 * loaded `tpeg-core`/`tpeg-combinator` namespaces. */
const compileStart = (
  code: string,
  core: Record<string, unknown>,
  combinator: Record<string, unknown>,
): Parser<unknown> => {
  const body = code.replace(/^export const (\w+)/gm, "const $1");
  const scope = { ...combinator, ...core };
  const factory = new Function(
    ...Object.keys(scope),
    `${body}\nreturn { start };`,
  );
  return (factory(...Object.values(scope)) as { start: Parser<unknown> }).start;
};

interface TableRow {
  /** The table's "Grammar Pattern" column, as a rule body. */
  readonly pattern: string;
  /** Input to run the compiled `start` rule against. */
  readonly input: string;
  /** Asserts the actual runtime value matches the table's "Capture
   * Structure" column. */
  readonly check: (val: unknown) => void;
  /** Extra rule definitions appended after `start`'s -- only needed for
   * the `rule_name` row, whose pattern is a reference to another rule. */
  readonly extraRules?: string;
}

const ROWS: readonly TableRow[] = [
  {
    pattern: '"literal"',
    input: "literal",
    check: (v) => expect(v).toBe("literal"),
  },
  { pattern: "[a-z]", input: "q", check: (v) => expect(v).toBe("q") },
  {
    pattern: "[a-z]+",
    input: "abc",
    check: (v) => expect(v).toEqual(["a", "b", "c"]),
  },
  {
    // `rule_name` captures whatever the referenced rule returns --
    // unwrapped, not re-wrapped.
    pattern: "sub",
    extraRules: '  sub = "z"',
    input: "z",
    check: (v) => expect(v).toBe("z"),
  },
  {
    pattern: 'label:"x"',
    input: "x",
    check: (v) => expect(v).toEqual({ label: "x" }),
  },
  {
    pattern: '"x" "y"',
    input: "xy",
    check: (v) => expect(v).toEqual(["x", "y"]),
  },
  {
    pattern: 'left:"x" right:"y"',
    input: "xy",
    check: (v) => expect(v).toEqual({ left: "x", right: "y" }),
  },
  {
    pattern: 'name:"x" "y" age:"z"',
    input: "xyz",
    check: (v) => expect(v).toEqual({ name: "x", age: "z" }),
  },
  {
    pattern: '"x" / "y"',
    input: "y",
    check: (v) => expect(v).toBe("y"),
  },
  {
    // Labeled choice: `choice()` forwards whichever alternative matched
    // unchanged, so only that one alternative's label ends up present in
    // the result -- the OTHER label is simply absent (not present-with-
    // undefined), which is what makes `{ a?: T1, b?: T2 }` (both fields
    // optional) an accurate type for it.
    pattern: 'a:"x" / b:"y"',
    input: "y",
    check: (v) => expect(v).toEqual({ b: "y" }),
  },
  {
    pattern: '"x"*',
    input: "xx",
    check: (v) => expect(v).toEqual(["x", "x"]),
  },
  {
    pattern: 'items:"x"*',
    input: "xx",
    check: (v) => expect(v).toEqual({ items: ["x", "x"] }),
  },
  {
    pattern: '"x"+',
    input: "xx",
    check: (v) => expect(v).toEqual(["x", "x"]),
  },
  {
    // Unlabeled optional -- match case: [T].
    pattern: '"x"?',
    input: "x",
    check: (v) => expect(v).toEqual(["x"]),
  },
  {
    // Unlabeled optional -- no-match case: [].
    pattern: '"x"?',
    input: "",
    check: (v) => expect(v).toEqual([]),
  },
  {
    pattern: 'value:"x"?',
    input: "",
    check: (v) => expect(v).toEqual({ value: [] }),
  },
  {
    pattern: '("x" / "y")',
    input: "x",
    check: (v) => expect(v).toBe("x"),
  },
  {
    pattern: 'grp:("x" / "y")',
    input: "x",
    check: (v) => expect(v).toEqual({ grp: "x" }),
  },
  {
    pattern: '&"x" "x"',
    input: "x",
    // `&pattern`'s own slot is `undefined`, not `null`.
    check: (v) => expect(v).toEqual([undefined, "x"]),
  },
  {
    pattern: '!"y" "x"',
    input: "x",
    check: (v) => expect(v).toEqual([undefined, "x"]),
  },
  {
    pattern: '"a" ~ "b"',
    input: "ab",
    check: (v) => expect(v).toEqual(["a", "b"]),
  },
  {
    pattern: '"a" ~',
    input: "a",
    // A single post-Cut survivor is bare, not a 1-tuple.
    check: (v) => expect(v).toBe("a"),
  },
];

describe("docs/peg-grammar.md's Capture Structure Reference Table (each row actually run, not just re-derived)", () => {
  test("this file's row list stays non-empty (sanity check for the test loop below)", () => {
    expect(ROWS.length).toBeGreaterThan(0);
  });

  test.each(ROWS.map((row, i) => [i, row] as const))(
    "row #%i (`%s`) produces the value the table's Capture Structure column claims",
    async (_i, row) => {
      const core = (await import(
        "@suzumiyaaoba/tpeg-core"
      )) as unknown as Record<string, unknown>;
      const combinator = (await import(
        "@suzumiyaaoba/tpeg-combinator"
      )) as unknown as Record<string, unknown>;

      const source = `grammar G {\n  start = ${row.pattern}\n${row.extraRules ?? ""}\n}`;
      const parsed = grammarDefinition(source, 0);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      const code = generateTypeScriptParser(parsed.val, {
        includeImports: false,
        includeTypes: false,
      }).code;
      const start = compileStart(code, core, combinator);
      const result = start(row.input, 0);
      expect(result.success).toBe(true);
      if (!result.success) return;

      row.check(result.val);
    },
  );
});

/**
 * Regression test: every `grammar Name { ... }` example in
 * docs/peg-grammar.md should parse via tpegModuleFile (imports + a grammar
 * block). This directly encodes "the doc's examples actually parse" instead
 * of relying on hand-copied fixtures that can drift from the real doc text.
 *
 * A block counts as passing if tpegModuleFile succeeds on it *at all* -
 * several of these code fences contain more than one `grammar { ... }` (e.g.
 * a base module followed by a second, unrelated example), and tpegModuleFile
 * only parses the first one, leaving the rest as unconsumed trailing input.
 * That's expected: this test is about "does the file's leading module parse
 * without failing," not "is every byte of the fence consumed."
 *
 * Passing also does not mean every rule body's AST is semantically correct.
 * Qualified references (`module.rule`) inside a rule body - e.g. the module
 * composition example's `assignment = lit.identifier "=" expr.expression` -
 * still parse "successfully", but wrongly: composition.ts's basicSyntax
 * doesn't try qualifiedIdentifier, so "." falls through to AnyChar, splitting
 * `lit.identifier` into three AST nodes (Identifier "lit", AnyChar,
 * Identifier "identifier") instead of one qualified reference. Adjacency
 * (this session's composition.ts fix) is what makes that sequence succeed at
 * all rather than fail. Fixing this is a parser-only gap - codegen.ts
 * already handles a QualifiedIdentifier node - but out of scope here.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@suzumiyaaoba/tpeg-core";
import { tpegModuleFile } from "./grammar";

const docsPath = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "docs",
  "peg-grammar.md",
);
const docsContent = readFileSync(docsPath, "utf8");

const fencedTpegBlocks = [
  ...docsContent.matchAll(/```tpeg\n([\s\S]*?)```/g),
].map((match) => match[1] ?? "");

const grammarBlocks = fencedTpegBlocks.filter((block) =>
  /\bgrammar\s+[\w.]+\s*(\n|\s)*(extends|includes)?[\s\S]*?{/.test(block),
);

describe("docs/peg-grammar.md grammar examples", () => {
  test("the doc actually contains grammar-block examples to check (sanity check for this test itself)", () => {
    expect(grammarBlocks.length).toBeGreaterThan(0);
  });

  test.each(grammarBlocks.map((block, i) => [i, block] as const))(
    "block #%i parses via tpegModuleFile",
    (_i, block) => {
      const result = parse(tpegModuleFile)(block);
      expect(result.success).toBe(true);
    },
  );
});

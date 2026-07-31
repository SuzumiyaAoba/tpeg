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
 * Rule bodies are also checked for semantic correctness where it matters:
 * composition.ts's basicSyntax now tries qualifiedIdentifier before
 * identifier, so cross-module references like `lit.identifier` inside a rule
 * body (e.g. the module composition example's `assignment = lit.identifier
 * "=" expr.expression`) parse as a single QualifiedIdentifier node rather
 * than degrading to Identifier + AnyChar + Identifier. See
 * composition.spec.ts for direct coverage of that parsing behavior.
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

  test("the module-composition example's 'assignment' rule parses qualified references as QualifiedIdentifier nodes, not Identifier+AnyChar+Identifier", () => {
    const mixinBlock = grammarBlocks.find((block) =>
      block.includes("lit.identifier"),
    );
    expect(mixinBlock).toBeDefined();

    const result = parse(tpegModuleFile)(mixinBlock ?? "");
    expect(result.success).toBe(true);
    if (result.success) {
      const assignment = result.val.grammar.rules.find(
        (rule) => rule.name === "assignment",
      );
      expect(assignment?.pattern.type).toBe("Sequence");
      if (assignment?.pattern.type === "Sequence") {
        expect(assignment.pattern.elements.map((el) => el.type)).toEqual([
          "QualifiedIdentifier",
          "StringLiteral",
          "QualifiedIdentifier",
        ]);
      }
    }
  });
});

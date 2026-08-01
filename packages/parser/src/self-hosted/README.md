# TPEG self-hosting proof of concept

This directory demonstrates that TPEG's own grammar-definition syntax can be
described *in TPEG itself* (using labeled captures + semantic actions,
`docs/peg-grammar.md`'s "Semantic Actions" section), compiled by the existing
`tpeg-cli`/`tpeg-parser` code generator, and validated against the
hand-written parser (`packages/parser/src/composition.ts`, `grammar.ts`, etc.)
for byte-for-byte AST equivalence.

**This is a validation artifact, not a replacement.** Nothing in
`packages/parser/src/*.ts` (outside this directory) was changed. The
hand-written parser remains the one actually used by `tpeg-parser`/`tpeg-cli`.

## Layout

- `grammar-source/*.tpeg` - the self-hosted grammar, built up in four layers
  (each one is a complete, standalone grammar - not a diff on the previous
  layer - so each can be regenerated and tested independently):
  1. `01-leaf.tpeg` - string literals, character classes, identifiers,
     qualified identifiers.
  2. `02-action.tpeg` - the semantic action block (`{ ... }`) itself, matched
     via **PEG recursion** instead of a manual brace-depth counter.
  3. `03-composition.tpeg` - everything in `01`+`02`, plus groups, lookahead
     (`&`/`!`), repetition (`*`/`+`/`?`/`{n,m}`), labels, and sequence/choice.
  4. `04-grammar.tpeg` - everything in `03`, plus rule definitions and plain
     `grammar Name { ... }` blocks with `@key: value`/`@flag` annotations and
     `//` comments.
- `generated/*.ts` - each layer's generated TypeScript, produced by running
  `bun run packages/cli/src/cli.ts <file>.tpeg -o generated/<name>.ts` from
  the repo root. Regenerate after editing a `.tpeg` source.
- `*.compare.spec.ts` - for each layer, runs the same inputs through the
  generated parser and the corresponding hand-written parser and asserts the
  AST/position results match exactly.

## What's excluded from this PoC

Scoped out entirely - none of it is exercised by any `.tpeg` file here:

- The **module system**: `import`/`export`, `extends`/`includes`,
  `@dependencies`/`@conflicts`/`@requires` (`module.ts`, ~200 lines of
  `grammar.ts`).
- **Transform function definitions** (`transforms Name@language { ... }`,
  `transforms.ts`).
- **Documentation comment collection** (`///` comments attached to a rule's
  `documentation` field) - plain `//` comments are supported and ignored,
  matching the hand-written parser's behavior for those.

## The key finding: no bounded pre-scan needed

`grammar.ts`'s hand-written `grammarRuleExpression` exists to stop a rule's
pattern from greedily consuming the next rule, since PEG sequences here treat
newlines as ordinary inter-element whitespace (needed to allow a rule body to
span multiple lines). It does this with a manual, string-level pre-scan that
tracks brace depth and skips over string/character-class contents by hand.

This PoC's `04-grammar.tpeg` needs none of that. `sequenceContinuation`
(in `03-composition.tpeg`) gates each additional sequence element on a single
negative lookahead:

```tpeg
notNextRuleStart = !(identifierName sameLineWs "=")
sequenceContinuation = interWs notNextRuleStart labeled
```

`"identifier <same-line-whitespace> ="` is never valid inside a TPEG
expression (only in a rule definition), so this lookahead rejects exactly the
one case that would otherwise let a sequence eat into the next rule - without
touching anything that's actually part of a legitimate expression. This was
verified independently against the hand-written parser (temporarily patching
`composition.ts`/`grammar.ts` to use this lookahead instead of the pre-scan
ran all 497 tests in `packages/parser` unchanged - the patch was reverted,
since replacing the production pre-scan is a separate, deliberate change, not
a side effect of this PoC).

`grammar.compare.spec.ts` specifically covers the cases the pre-scan exists
for: adjacent rules with no blank line between them, a multi-line action with
its own nested braces, an action's closing brace on the same line as the
grammar block's own closing brace, and a character class containing literal
`{`/`}` immediately before a multi-line-action rule.

## Bugs this PoC surfaced

**`brace-scanner.ts`'s multi-line column arithmetic is off by one**, found by
`action.compare.spec.ts`. Relative to `tpeg-core`'s own `nextPos` convention
(`utils.ts`): after a match crosses a line break, `brace-scanner.ts` computes
the new column as `(length of the last consumed line) + 1`, while `nextPos`
resets column to `0` on a newline and increments per character consumed after
that - so after one character following the reset, `nextPos` says column `1`,
`brace-scanner.ts` says column `2`. The self-hosted grammar, built entirely
from `tpeg-core` combinators, doesn't have this bug because it never does its
own position arithmetic. This is a pre-existing issue (inherited from the
original `functionBody` in `transforms.ts`) and is **not fixed here** -
`offset`/`line` are unaffected, only the reported `column` after a multi-line
action or transform body, which is display-only (it doesn't affect where
subsequent parsing resumes).

**Generated files with a multi-label action failed `tsc --noEmit`** - this one
*was* fixed (`codegen.ts`'s `wrapWithAction`/`filterReferencedLabels`), since
it's a defect in the semantic-actions feature itself, not something specific
to this PoC. `captureSequence()`'s TS return type is a union of the merged
capture object and a positional tuple, so destructuring an untyped `$$` (e.g.
`const { left, right } = $$;`) failed with `TS2339` under `tsc`, and an action
that never referenced `$$` or any label left it as an unused local under
`noUnusedLocals`. Both were invisible until this PoC actually saved generated
output to real `.ts` files and ran `tsc --noEmit` on them - every prior test
of the semantic-actions feature executed generated code via `new Function`,
which never typechecks anything. Fixed by typing `$$` as `any` (only under
`includeTypes`, so `includeTypes: false` output stays plain JS) and only
destructuring the labels an action's code actually references.

## Regenerating

```bash
bun run packages/cli/src/cli.ts packages/parser/src/self-hosted/grammar-source/04-grammar.tpeg \
  -o packages/parser/src/self-hosted/generated/grammar.generated.ts
```

(the `.generated.ts` suffix matches this repo's `biome.json` ignore pattern, so
the machine-generated output - which uses `Parser<any>` throughout and would
otherwise fail lint - is exempted from formatting/lint checks.)

(repeat for `01`-`03` against their respective output files), then:

```bash
cd packages/parser && bun test src/self-hosted/
```

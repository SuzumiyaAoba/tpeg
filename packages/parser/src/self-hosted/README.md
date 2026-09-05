# TPEG self-hosting proof of concept

This directory demonstrates that TPEG's own grammar-definition syntax can be
described _in TPEG itself_ (using labeled captures + semantic actions,
`docs/peg-grammar.md`'s "Semantic Actions" section), compiled by the existing
`tpeg-cli`/`tpeg-parser` code generator, and validated against the
hand-written parser (`packages/parser/src/composition.ts`, `grammar.ts`, etc.)
for byte-for-byte AST equivalence.

**This is a validation artifact, not a replacement.** Nothing in
`packages/parser/src/*.ts` (outside this directory) was changed. The
hand-written parser remains the one actually used by `tpeg-parser`/`tpeg-cli`.

## Layout

- `grammar-source/*.tpeg` - the self-hosted grammar, built up in five layers
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
  5. `05-full.tpeg` - everything in `04`, plus the module system
     (`import`/`export`, `extends`/`includes`, `@dependencies`/`@conflicts`/
     `@requires`) and `transforms Name@language { ... }` definitions - see
     "Module system and transforms" below. Kept as its own layer rather than
     extending `04-grammar.tpeg` in place: plain `grammarDefinition` drops
     exports/extends/includes entirely, so any grammar exercising those needs
     `modularGrammarDefinition` as its oracle instead, and touching
     `04-grammar.tpeg`'s rules in place would invalidate its own 11 existing
     comparison cases for no reason - `04-grammar.tpeg` stays frozen.
- `generated/*.ts` - each layer's generated TypeScript, produced by running
  `bun run packages/cli/src/cli.ts <file>.tpeg -o generated/<name>.ts` from
  the repo root. Regenerate after editing a `.tpeg` source.
- `*.compare.spec.ts` - for each layer, runs the same inputs through the
  generated parser and the corresponding hand-written parser and asserts the
  AST/position results match exactly.

## What's excluded from this PoC

- **Documentation comment collection** (`///` comments attached to a rule's
  `documentation` field) is **not applicable, not merely unimplemented**:
  `grammar.ts`'s `ruleDefinition` calls `createRuleDefinition(name, pattern)`
  with only two arguments, and its `grammarItem` choice tries
  `singleLineComment` (`literal("//")`) _before_ `documentationComment`
  (`literal("///")`) - a `///` line matches `singleLineComment` first (its
  `zeroOrMore(nonNewlineChar)` happily consumes the leftover third `/` as
  ordinary content) and `///` never reaches `documentationComment` at all.
  `RuleDefinition.documentation` has no producer anywhere in
  `packages/parser/src/*.ts` outside test fixtures - grep
  `createRuleDefinition\(` across the package and every real call site passes
  exactly two arguments. So there is no upstream behavior to model: this PoC
  (see `05-full.tpeg`'s `singleLineCommentNode`) accepts and discards a `///`
  line exactly like a `//` line, which already matches the hand-written
  parser's actual behavior byte-for-byte (`full.compare.spec.ts` has a case
  proving it). Populating `RuleDefinition.documentation` for real would be a
  production change to `grammar.ts` (reorder that `choice`, thread a doc-
  comment array through to `createRuleDefinition`) plus every consumer of
  `RuleDefinition` (codegen, type inference, etc.) - out of scope here since
  it isn't a self-hosted-grammar task at all.
- **`@memoize` rule-level annotations** remain out of scope, same as they
  were for `04-grammar.tpeg` (untouched by this layer) - `grammarItemNode`
  here still treats every `@key` uniformly as a generic annotation.

The module system and `transforms` definitions - previously excluded here -
are now covered by `05-full.tpeg`; see below.

## Module system and transforms (`05-full.tpeg`)

`05-full.tpeg` extends `04-grammar.tpeg`'s grammar-block layer with three
additional top-level rules, each compared against a different
hand-written-parser oracle in `full.compare.spec.ts`:

- `transformDefinitionNode` vs. `transforms.ts`'s `transformDefinition` -
  `transforms Name@language { fn(param: Type) -> ReturnType { ...body... } }`,
  including object-literal parameter/return types and generic return types
  (`-> Result<Node>`).
- `modularGrammarBlockNode` vs. `grammar.ts`'s `modularGrammarDefinition` -
  a full `grammar Name [extends Other] [includes A, B] { ...items... }`
  block, including `@export`, `@dependencies`/`@conflicts`/`@requires`, and
  embedded `transforms` blocks.
- `tpegFileNode` vs. `grammar.ts`'s `tpegModuleFile` - zero or more `import`
  statements (simple/selective/versioned) followed by a modular grammar
  block. Note this oracle returns a plain `{ imports, grammar }` object, not
  an AST node with its own `type` field.

A handful of hand-written-parser quirks had to be reproduced exactly (not
"corrected") for these to compare equal:

- `@namespace` is **not** wired into `ModuleInfo.namespace` by
  `modularGrammarDefinition` despite `module.ts`'s own module doc comment
  listing it as a planned annotation - it lands in `annotations` like any
  other unrecognized `@key`, and nowhere else. `05-full.tpeg` does the same.
- `moduleInfoLists`/`moduleInfoRecords` (`@dependencies`/`@conflicts` and
  `@requires`) **accumulate** across repeated annotations with the same key
  (list concatenation, record spread) rather than the last one winning -
  `full.compare.spec.ts` repeats all three keys (not just `@dependencies`)
  so a regression in any one key's merge logic would be caught.
- A comment (`//`, `///`, or `/* ... */`) is tolerated in the same three
  header positions `grammar.ts` tolerates one: before the `import`/`grammar`
  keyword (`leadingContent`), and between a grammar block's
  name/`extends`/`includes` clauses and its opening `{`
  (`optionalWhitespaceOrComment`) - `05-full.tpeg`'s `leadingContent` rule
  covers both. Plain whitespace-only skipping at these positions would parse
  strictly less than the hand-written parser does (a leading comment before
  `grammar`, or a trailing one before `{`, would fail here but succeed
  there) - `full.compare.spec.ts` has a case for each position.
- `@export: [...]` only produces an `exports` field when the list is
  non-empty; `@export: []` yields no `exports` field at all
  (`exportedRules.length > 0` in `grammar.ts`).
- `transformFunctions` requires **at least one** function -
  `transforms T@typescript { }` fails on both sides.
- `targetLanguage`'s "not a prefix of a longer identifier" guard
  (`transforms.ts`) only excludes a following `[a-zA-Z0-9]`, not `_` - so
  `typescript_x` still resolves to language `typescript` on both sides, not
  a parse failure, matching that guard's actual (not fully identifier-aware)
  regex.
- **A rule directly followed by a `transforms` block in the same grammar
  block used to fail on both sides - now fixed on both sides.**
  `grammar.ts`'s `grammarRuleExpression` (the hand-rolled rule-boundary
  scanner described below) didn't treat the `transforms` keyword as a
  rule/block boundary - only `"identifier <same-line-ws> ="` and a bare `}`
  were recognized boundaries - so it greedily scanned the `transforms` block
  into the _preceding_ rule's own pattern slice, hit `expression()` stopping
  short at the block's own `@` (which nothing in `expression()`'s grammar
  accepts), and the whole grammar block parse failed with an unhelpful error
  (`Unexpected content after rule expression: "@typescript { f() ->"`,
  pointing at the wrong construct entirely). Fixed in `grammarRuleExpression`
  by recognizing a whole-word `"transforms"` (not a prefix - a rule
  legitimately named e.g. `transformsFoo` is unaffected) as a boundary the
  same way `"}"` and `"@"` already were. `05-full.tpeg`'s `notNextRuleStart`
  got the analogous fix (an added `!("transforms" !identContChar)` negative
  lookahead) to keep parity - see `full.compare.spec.ts`'s
  `modularGrammarBlockNode` cases for a rule directly followed by
  `transforms`, `transforms` between two rules, and the `transformsFoo`
  non-regression case.

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
_was_ fixed (`codegen.ts`'s `wrapWithAction`/`filterReferencedLabels`), since
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

Regenerate a layer's output after editing its `.tpeg` source with
`bun run packages/cli/src/cli.ts <source> -o <output>`, one line per layer:

```bash
bun run packages/cli/src/cli.ts packages/parser/src/self-hosted/grammar-source/01-leaf.tpeg \
  -o packages/parser/src/self-hosted/generated/leaf.generated.ts
bun run packages/cli/src/cli.ts packages/parser/src/self-hosted/grammar-source/02-action.tpeg \
  -o packages/parser/src/self-hosted/generated/action.generated.ts
bun run packages/cli/src/cli.ts packages/parser/src/self-hosted/grammar-source/03-composition.tpeg \
  -o packages/parser/src/self-hosted/generated/composition.generated.ts
bun run packages/cli/src/cli.ts packages/parser/src/self-hosted/grammar-source/04-grammar.tpeg \
  -o packages/parser/src/self-hosted/generated/grammar.generated.ts
bun run packages/cli/src/cli.ts packages/parser/src/self-hosted/grammar-source/05-full.tpeg \
  -o packages/parser/src/self-hosted/generated/full.generated.ts
```

(the `.generated.ts` suffix matches this repo's `vite.config.ts` `fmt`/`lint`
ignore patterns, so the machine-generated output - which uses `Parser<any>`
throughout and would otherwise fail lint - is exempted from formatting/lint
checks. It is **not** exempt from typechecking - run `bun run typecheck`
after regenerating.) Then:

```bash
bunx vp test packages/parser/src/self-hosted/
```

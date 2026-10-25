import { parseArgs } from "node:util";

export const USAGE = `Usage: tpeg <input.tpeg> [options]

Parses a .tpeg grammar file (a "grammar Name { ... }" block, optionally
followed by one or more "transforms Name@typescript { ... }" blocks) and
generates a standalone TypeScript parser.

Options:
  -o, --output <path>       Write generated code to this file (default: stdout)
      --name-prefix <name>  Prefix every generated parser export with <name>
      --optimize            Use the performance-optimized code generator
                             (also enables FIRST-set predictive dispatch by
                             default -- see --ast-optimize for rewrites
                             that stay opt-in)
      --ast-optimize         Rewrite the grammar before code generation:
                             left-factor shared alternative prefixes, merge
                             adjacent character classes, and degenerate
                             "!x ." negative-lookahead pairs into a negated
                             character class. Off by default because both
                             left-factoring and negative-lookahead
                             degeneration can change a rule's captured
                             .val shape (not just what a semantic action
                             computes from it, but also what a label
                             (name:expr) captures) -- review generated
                             output for grammars with actions or labels
                             before relying on this in production.
      --regex-fusion         Compile non-terminal-free rules to a single
                             regexFused(...) call instead of a combinator
                             tree (see packages/core/src/regex-fused.ts).
                             Requires --optimize. Off by default pending
                             more real-world grammar coverage.
      --regex-fusion-subtree Like --regex-fusion (implies it), but also
                             fuses any maximal fusable SUB-expression, not
                             just a rule's entire pattern -- reaches
                             non-terminal-free fragments sitting behind a
                             label or a semantic action, which disqualify
                             the whole rule from --regex-fusion alone (see
                             packages/parser/src/regex-fusion.ts's
                             planFusion). Requires --optimize.
      --auto-cut             Insert cut/commit at provably safe positions
                             in ordered choices (see
                             packages/parser/src/ast-optimize.ts's
                             insertAutomaticCuts). Applied after
                             --ast-optimize's rewrites, if both are given.
                             Off by default: this is a more cautious
                             opt-in than --ast-optimize's rewrites.
      --promote-cuts         Mark every provably-safe cut (see
                             packages/parser/src/ast-optimize.ts's
                             promoteGlobalCuts) so it compiles to
                             commitAtTopLevel instead of the ordinary,
                             purely-local commit, letting @memoize'd rules
                             discard now-unreachable cache entries.
                             Applied after --auto-cut, if both are given
                             (a cut has to exist before it can be
                             promoted) -- a no-op without --auto-cut and no
                             hand-written "~" in the source grammar.
      --no-types            Omit "Parser<T>" type annotations from output
  -h, --help                Show this help message
  -v, --version             Show the CLI version

Examples:
  tpeg grammar.tpeg -o parser.ts
  tpeg grammar.tpeg --optimize --name-prefix my_ > parser.ts
  tpeg grammar.tpeg --optimize --ast-optimize > parser.ts
  tpeg grammar.tpeg --optimize --regex-fusion --auto-cut > parser.ts
  tpeg grammar.tpeg --optimize --regex-fusion-subtree > parser.ts
`;

export interface CliOptions {
  output?: string;
  namePrefix?: string;
  optimize: boolean;
  astOptimize: boolean;
  regexFusion: boolean;
  regexFusionSubtree: boolean;
  autoCut: boolean;
  promoteCuts: boolean;
  types: boolean;
  help: boolean;
  version: boolean;
}

export function parseCliArgs(argv: string[]): {
  options: CliOptions;
  positionals: string[];
} {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      output: { type: "string", short: "o" },
      "name-prefix": { type: "string" },
      optimize: { type: "boolean", default: false },
      "ast-optimize": { type: "boolean", default: false },
      "regex-fusion": { type: "boolean", default: false },
      "regex-fusion-subtree": { type: "boolean", default: false },
      "auto-cut": { type: "boolean", default: false },
      "promote-cuts": { type: "boolean", default: false },
      "no-types": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });

  return {
    options: {
      ...(values.output !== undefined ? { output: values.output } : {}),
      ...(values["name-prefix"] !== undefined
        ? { namePrefix: values["name-prefix"] }
        : {}),
      optimize: values.optimize ?? false,
      astOptimize: values["ast-optimize"] ?? false,
      // `--regex-fusion-subtree` implies `--regex-fusion`: no one passing
      // the more aggressive flag wants fusion to end up disabled, so
      // requiring both separately would be pure friction. NOT because
      // "subtree" is a strict superset of "rule" -- it isn't (see
      // `planFusion`'s doc comment): "subtree" scope weight-gates EVERY
      // candidate, including a whole rule's own pattern, so a rule that
      // "rule" scope fuses unconditionally (e.g. a single bare literal,
      // weight 1) can end up UNFUSED under "subtree" if it doesn't clear
      // `MIN_FUSION_WEIGHT` -- a deliberate correction, not a regression.
      regexFusion:
        (values["regex-fusion"] ?? false) ||
        (values["regex-fusion-subtree"] ?? false),
      regexFusionSubtree: values["regex-fusion-subtree"] ?? false,
      autoCut: values["auto-cut"] ?? false,
      promoteCuts: values["promote-cuts"] ?? false,
      types: !(values["no-types"] ?? false),
      help: values.help ?? false,
      version: values.version ?? false,
    },
    positionals,
  };
}

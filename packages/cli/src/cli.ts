#!/usr/bin/env bun
/**
 * tpeg -- generate a TypeScript parser from a .tpeg grammar file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  type GrammarDefinition,
  offsetToPos,
  parse,
} from "@suzumiyaaoba/tpeg-core";
import {
  generateTypeScriptParser,
  skipTrailingWhitespaceAndComments,
  tpegModuleFile,
} from "@suzumiyaaoba/tpeg-parser";

import { generateParser, prepareGrammar } from "./generation";
import { type CliOptions, USAGE, parseCliArgs } from "./options";

function readVersion(): string {
  const url = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
  return pkg.version;
}

/**
 * Neutralizes control characters (CR, LF, TAB, and other C0 bytes) before
 * writing untrusted text (a grammar's own error `message`/`expected`/`found`
 * strings, which can contain any byte from the source file) to the
 * terminal. A raw `\r` in particular rewinds the cursor to the start of the
 * line and overwrites everything printed so far, making the error
 * unreadable -- this is display-safety, not the JS-string-literal escaping
 * `escapeStringLiteral` (`packages/parser/src/constants.ts`) does (that one
 * also escapes quotes/backslashes for embedding in generated TS source,
 * which would be wrong here and make plain messages harder to read).
 */
function sanitizeForTerminal(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\n") {
      result += "\\n";
    } else if (char === "\r") {
      result += "\\r";
    } else if (char === "\t") {
      result += "\\t";
    } else if (code < 0x20 || code === 0x7f) {
      result += `\\x${code.toString(16).padStart(2, "0")}`;
    } else {
      result += char;
    }
  }
  return result;
}

export function run(argv: string[]): number {
  let options: CliOptions;
  let positionals: string[];
  try {
    ({ options, positionals } = parseCliArgs(argv));
  } catch (error) {
    process.stderr.write(`error: ${(error as Error).message}\n\n`);
    process.stderr.write(USAGE);
    return 1;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (options.version) {
    try {
      process.stdout.write(`${readVersion()}\n`);
    } catch (error) {
      process.stderr.write(
        `error: could not read package version: ${(error as Error).message}\n`,
      );
      return 1;
    }
    return 0;
  }

  const inputPath = positionals[0];
  if (!inputPath) {
    process.stderr.write("error: missing required <input.tpeg> argument\n\n");
    process.stderr.write(USAGE);
    return 1;
  }
  if (positionals.length > 1) {
    process.stderr.write(
      `error: unexpected extra argument(s): ${positionals
        .slice(1)
        .map(sanitizeForTerminal)
        .join(", ")} -- only one <input.tpeg> is accepted\n\n`,
    );
    process.stderr.write(USAGE);
    return 1;
  }

  // Argument-combination errors are reported before touching the
  // filesystem or the parser: they don't depend on the input file's
  // content, so there's no reason to make a user wait through a read and
  // a parse (potentially of a large file) just to be told the flags
  // don't go together.
  if (options.regexFusion && !options.optimize) {
    process.stderr.write(
      "error: --regex-fusion/--regex-fusion-subtree requires --optimize (the standard generator has no such option)\n",
    );
    return 1;
  }

  let source: string;
  try {
    source = readFileSync(inputPath, "utf8");
  } catch (error) {
    process.stderr.write(
      `error: could not read "${inputPath}": ${(error as Error).message}\n`,
    );
    return 1;
  }
  // A UTF-8 BOM is a file-encoding artifact, not grammar content -- strip
  // it the way tsc/node strip BOMs from source files. Without this, a
  // BOM'd .tpeg file (the default from some Windows editors) fails at
  // position 0 with an invisible `found:` character.
  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
  }

  // `tpegModuleFile` (not `tpegFile`) so a `.tpeg` file whose top-level
  // `import "..."` statements the module system documents is accepted
  // here too (#112) -- tpegFile's grammar-only entry rejected them.
  const parseResult = parse(tpegModuleFile)(source);
  // `parse()` only requires `tpegModuleFile` to match a PREFIX of `source`, not
  // the whole file (see `packages/core/src/utils.ts`'s `parse`) -- so a
  // syntactically valid grammar followed by garbage (a typo'd second
  // `grammar` block, a misspelled `transforms` keyword that silently
  // stops matching as a transform block) would otherwise be accepted
  // with the trailing content silently discarded and no diagnostic at
  // all. `skipTrailingWhitespaceAndComments` (the same helper the
  // grammar parser's own rule-boundary scan uses) allows trailing
  // whitespace and comments after the last rule/transform, exactly like
  // one would expect at the end of a normal source file, without
  // requiring literal end-of-input immediately after the last token.
  const consumedThroughEnd =
    parseResult.success &&
    skipTrailingWhitespaceAndComments(source, parseResult.next) ===
      source.length;
  if (!parseResult.success || !consumedThroughEnd) {
    const pos = parseResult.success ? parseResult.next : parseResult.error.pos;
    const { line, column } = offsetToPos(source, pos);
    if (parseResult.success) {
      process.stderr.write(
        `error: failed to parse "${inputPath}": unexpected content after line ${line}, column ${column + 1} (the grammar/transforms block(s) before this point parsed successfully, but did not consume the rest of the file)\n`,
      );
      return 1;
    }
    const { message, expected, found } = parseResult.error;
    process.stderr.write(
      `error: failed to parse "${inputPath}" at line ${line}, column ${column + 1}: ${sanitizeForTerminal(message)}\n`,
    );
    if (expected) {
      const expectedList = Array.isArray(expected)
        ? expected.join(", ")
        : expected;
      process.stderr.write(
        `  expected: ${sanitizeForTerminal(expectedList)}\n`,
      );
    }
    if (found) {
      process.stderr.write(`  found: ${sanitizeForTerminal(found)}\n`);
    }
    return 1;
  }

  // `tpegModuleFile` returns the module's `imports` alongside the
  // grammar. Imports are syntactically accepted but the generated parser
  // is a single module -- references to imported rules still resolve
  // through the external-binding escape hatch, which
  // `buildQualifiedIdentifierWarnings` (wired into both generators)
  // reports as warnings below. Surface the same limitation here so it
  // isn't silent when a file actually declares imports.
  if (parseResult.val.imports.length > 0) {
    const list = parseResult.val.imports
      .map((stmt) => `"${stmt.modulePath}"`)
      .join(", ");
    process.stderr.write(
      `note: this file declares ${parseResult.val.imports.length} import(s) (${list}); ` +
        `the generated parser does not resolve them -- imported rules must be supplied by the caller\n`,
    );
  }

  // `ModularGrammarDefinition` carries the module-only fields (imports,
  // exports, moduleInfo) the optimizers/generators don't consume -- pass
  // them the plain `GrammarDefinition` they expect.
  const parsedGrammar: GrammarDefinition = {
    type: "GrammarDefinition",
    name: parseResult.val.grammar.name,
    annotations: parseResult.val.grammar.annotations,
    rules: parseResult.val.grammar.rules,
    ...(parseResult.val.grammar.transforms !== undefined
      ? { transforms: parseResult.val.grammar.transforms }
      : {}),
  };

  // `applyAstOptimizations` (left-factoring, character-class merging,
  // negative-lookahead degeneration -- see packages/parser/src/ast-optimize.ts)
  // and `insertAutomaticCuts` both run ahead of code generation,
  // independently of which generator is chosen below: they rewrite the
  // grammar's AST, not the emitted code. `insertAutomaticCuts` runs AFTER
  // `applyAstOptimizations` deliberately -- left-factoring can turn a
  // choice's alternatives into disjoint-prefixed sequences that only then
  // become cut candidates, so running cuts second finds a superset of the
  // cut sites running them first would.
  //
  // Regex fusion (`--regex-fusion`/`--regex-fusion-subtree`) has no step
  // here at all -- it isn't an AST rewrite, it's entirely internal to
  // `generateOptimizedTypeScriptParser` (`packages/parser/src/regex-
  // fusion.ts`'s `planFusion`, consulted while walking the FINAL grammar
  // below). It necessarily runs last relative to every rewrite in this
  // function: fusing before `applyAstOptimizations`/`insertAutomaticCuts`
  // ran would fuse a `Choice` alternative into one opaque leaf before
  // left-factoring could restructure it or `insertAutomaticCuts` could
  // find a cut site inside it -- see `packages/parser/src/codegen-
  // optimized.ts`'s `generateOptimizedExpression` for where the fusion
  // check actually happens (after these AST passes have already produced
  // `grammar` below, at codegen time, not before it).
  const grammar = prepareGrammar(parsedGrammar, options);

  // Both generators call `validateGrammar` (`packages/parser/src/
  // grammar-validation.ts`) before producing any code, rejecting a
  // duplicate rule name or a left-recursive rule (direct, indirect, or
  // "hidden" behind a nullable prefix -- e.g. `expr = expr "+" term /
  // term`) with a thrown `Error`. Without input this small either grammar
  // defect would otherwise compile successfully and only fail once
  // actually PARSED against input, with a bare `RangeError: Maximum call
  // stack size exceeded` (left recursion) or a silent infinite hang
  // (duplicate rule name, inside `analyzeFirstSets`'s FIRST-set fixpoint)
  // pointing nowhere near the actual mistake. Caught here and reported
  // the same way every other grammar-authoring mistake in this file is:
  // a clean `error:` line on stderr and a non-zero exit, no output
  // written.
  let generated: ReturnType<typeof generateTypeScriptParser>;
  try {
    generated = generateParser(grammar, options);
  } catch (error) {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    return 1;
  }

  // Non-fatal generation warnings (e.g. an unresolved `QualifiedIdentifier`
  // reference -- see `buildQualifiedIdentifierWarnings`'s doc comment)
  // always go to stderr, never stdout: stdout is reserved for the
  // generated code itself when no `--output` is given (`tpeg g.tpeg |
  // some-tool` must not see a warning line mixed into the piped source).
  for (const warning of generated.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  // `options.output !== undefined`, not a truthiness check: an explicit
  // `-o ""` must not silently fall back to stdout -- let `writeFileSync`
  // reject the empty path and report it like any other bad output path.
  if (options.output !== undefined) {
    try {
      writeFileSync(options.output, generated.code, "utf8");
    } catch (error) {
      process.stderr.write(
        `error: could not write "${options.output}": ${(error as Error).message}\n`,
      );
      return 1;
    }
    process.stderr.write(
      `wrote ${generated.exports.length} parser(s) to ${options.output}\n`,
    );
  } else {
    process.stdout.write(generated.code);
    if (!generated.code.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }

  return 0;
}

if (import.meta.main) {
  // `process.exitCode = ...` (letting the process exit naturally) rather
  // than `process.exit(...)`: a write to a piped stdout (as opposed to a
  // file or a TTY) is asynchronous, and `process.exit()` terminates the
  // process immediately without waiting for pending writes to flush --
  // silently truncating large generated output (observed: a ~439KB
  // parser piped through `tpeg g.tpeg | wc -c` came out at exactly 64KiB,
  // still exit code 0). Setting `exitCode` and letting the event loop
  // drain lets Node/Bun flush the stdout buffer before the process
  // actually exits.
  process.exitCode = run(process.argv.slice(2));
}

#!/usr/bin/env bun
/**
 * tpeg -- generate a parser from a .tpeg grammar file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { isNativeLanguage } from "@suzumiyaaoba/tpeg-generator";
import {
  bundleGrammarFile,
  parseGrammarFile,
  toGrammarDefinition,
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
    process.stderr.write(
      `error: ${sanitizeForTerminal((error as Error).message)}\n\n`,
    );
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
        `error: could not read package version: ${sanitizeForTerminal((error as Error).message)}\n`,
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
  const nativeTarget = isNativeLanguage(options.language);
  if (
    !nativeTarget &&
    options.language !== "typescript" &&
    options.language !== "javascript"
  ) {
    process.stderr.write(
      `error: unsupported target language "${sanitizeForTerminal(options.language)}"\n`,
    );
    return 1;
  }
  if (
    nativeTarget &&
    (options.optimize || options.regexFusion || !options.types)
  ) {
    process.stderr.write(
      "error: --optimize, --regex-fusion and --no-types apply only to TypeScript/JavaScript targets\n",
    );
    return 1;
  }
  if (options.packageName !== undefined && options.language !== "go") {
    process.stderr.write("error: --package-name requires --language go\n");
    return 1;
  }
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
      `error: could not read "${sanitizeForTerminal(inputPath)}": ${sanitizeForTerminal((error as Error).message)}\n`,
    );
    return 1;
  }
  const parsed = parseGrammarFile(inputPath, source);
  if (!parsed.success) {
    const { line, column } = parsed;
    const { message, expected, found } = parsed.error;
    const detail =
      parsed.kind === "trailing"
        ? " (the parser did not consume the rest of the file)"
        : "";
    process.stderr.write(
      `error: failed to parse "${sanitizeForTerminal(inputPath)}" at line ${line}, column ${column}: ${sanitizeForTerminal(message)}${detail}\n`,
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

  const file = parsed.val;
  const bundle = options.bundle || nativeTarget;
  if (file.imports.length > 0 && !bundle) {
    const list = file.imports
      .map((stmt) => `"${sanitizeForTerminal(stmt.modulePath)}"`)
      .join(", ");
    process.stderr.write(
      `note: this file declares ${file.imports.length} import(s) (${list}); ` +
        `the generated parser does not resolve them -- imported rules must be supplied by the caller\n`,
    );
  }

  let generated: ReturnType<typeof generateParser>;
  try {
    const grammar = bundle
      ? bundleGrammarFile(file)
      : toGrammarDefinition(file.grammars[0]);
    generated = generateParser(prepareGrammar(grammar, options), options);
  } catch (error) {
    process.stderr.write(
      `error: ${sanitizeForTerminal((error as Error).message)}\n`,
    );
    return 1;
  }

  // Non-fatal generation warnings (e.g. an unresolved `QualifiedIdentifier`
  // reference -- see `buildQualifiedIdentifierWarnings`'s doc comment)
  // always go to stderr, never stdout: stdout is reserved for the
  // generated code itself when no `--output` is given (`tpeg g.tpeg |
  // some-tool` must not see a warning line mixed into the piped source).
  for (const warning of generated.warnings) {
    process.stderr.write(`warning: ${sanitizeForTerminal(warning)}\n`);
  }

  // `options.output !== undefined`, not a truthiness check: an explicit
  // `-o ""` must not silently fall back to stdout -- let `writeFileSync`
  // reject the empty path and report it like any other bad output path.
  if (options.output !== undefined) {
    try {
      writeFileSync(options.output, generated.code, "utf8");
    } catch (error) {
      process.stderr.write(
        `error: could not write "${sanitizeForTerminal(options.output)}": ${sanitizeForTerminal((error as Error).message)}\n`,
      );
      return 1;
    }
    process.stderr.write(
      `wrote ${generated.exports.length} parser(s) to ${sanitizeForTerminal(options.output)}\n`,
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

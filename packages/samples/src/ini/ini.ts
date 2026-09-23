import { takeUntil } from "@suzumiyaaoba/tpeg-combinator";
import {
  type Parser,
  any,
  charClass,
  choice,
  literal,
  map,
  negatedCharClass,
  not,
  oneOrMore,
  optional,
  parse,
  seq,
  zeroOrMore,
} from "@suzumiyaaoba/tpeg-core";

/**
 * INI Config File Parser Sample
 *
 * A parser for INI-style configuration files:
 * - `key = value` pairs (before any section header, they are "globals")
 * - `[section]` headers grouping key/value pairs
 * - `;` and `#` comments, both whole-line and trailing a value
 * - CRLF, LF, or CR line endings
 *
 * Dialect notes (INI has no single standard -- these are the choices this
 * sample makes):
 * - Keys and unquoted values are trimmed of surrounding whitespace.
 * - A comment character only starts a comment at the start of a line
 *   (after optional whitespace) or, inside a value, when preceded by at
 *   least one whitespace character -- so `password = a#b` keeps its `#`
 *   while `name = x ; note` drops the `; note`.
 * - There is no escaping and no quoted values: `"` is an ordinary value
 *   character.
 */

/**
 * Parsed representation of an INI document.
 */
export interface IniData {
  /** `key = value` lines that appear before the first `[section]` header. */
  globals: Record<string, string>;
  /** Section name -> its key/value pairs. */
  sections: Record<string, Record<string, string>>;
}

/**
 * One physical line of the file, classified by what it carries.
 * Exported so the `.tpeg` grammar twin (`ini.tpeg`) can return the same
 * line stream and share {@link assembleIniData}.
 */
export type IniLine =
  | { readonly type: "blank" }
  | { readonly type: "section"; readonly name: string }
  | { readonly type: "pair"; readonly key: string; readonly value: string };

// End of input -- succeeds only when nothing is left.
const EOF = not(any);

// Horizontal whitespace only -- a newline must never be skipped by `hws`,
// because it is what terminates a key/value line.
const htab = charClass(" ", "\t");
const hws = zeroOrMore(htab);

// Line ending: CRLF (Windows), LF (Unix), or CR (legacy Mac).
const eol = choice(literal("\r\n"), literal("\n"), literal("\r"));

// A line's own terminator: either a newline sequence or end of input, so
// the last line of a file without a trailing newline still parses.
const lineEnd = choice(eol, EOF);

// Comment text: `;` or `#` through (but not including) the end of the
// line. The newline itself is left for `lineEnd`.
const comment = seq(charClass(";", "#"), takeUntil(choice(eol, EOF)));

// A line carrying nothing but whitespace and/or a comment. Every
// alternative must CONSUME at least one character -- a
// `seq(hws, optional(comment), lineEnd)` shape can succeed zero-width at
// end of input, and a zero-width success inside `zeroOrMore(line)` is an
// infinite loop (the core repetition parser rejects it loudly).
const blankLine = map(
  choice(
    seq(hws, optional(comment), eol), // whitespace/comment ending in a newline
    seq(hws, comment, EOF), // trailing comment with no newline
    seq(oneOrMore(htab), EOF), // trailing whitespace with no newline
  ),
  (): IniLine => ({ type: "blank" }),
);

// Section name inside the brackets. `takeUntil` stops at the closing
// bracket or the end of the line; the `]` parser right after then decides
// whether the header was well formed (a missing `]` makes the sequence
// fail, so `[oops` is rejected rather than silently absorbed).
const sectionName = map(takeUntil(choice(literal("]"), eol)), (name) =>
  name.trim(),
);

const sectionLine = map(
  seq(literal("["), sectionName, literal("]"), hws, optional(comment), lineEnd),
  ([, name]): IniLine => ({ type: "section", name }),
);

// A key is one or more characters up to the `=` (or the end of the line,
// which then makes the `=` requirement fail). Requiring at least one
// character -- rather than `takeUntil`, which happily returns "" -- is
// what makes `= value` a parse error instead of an empty-key pair.
// Trimming happens here so `key =v` and `key= v` both yield `key`.
const keyText = map(oneOrMore(negatedCharClass("=", "\n", "\r")), (chars) =>
  chars.join("").trim(),
);

// A value runs to the end of the line or to an inline comment -- a `;`/`#`
// preceded by whitespace. Requiring the whitespace keeps `a#b` or `a;b`
// intact as data.
const valueText = map(
  takeUntil(choice(eol, seq(oneOrMore(htab), charClass(";", "#")))),
  (value) => value.trim(),
);

const pairLine = map(
  seq(
    keyText,
    hws,
    literal("="),
    hws,
    valueText,
    hws,
    optional(comment),
    lineEnd,
  ),
  ([key, , , , value]): IniLine => ({ type: "pair", key, value }),
);

// One line of the file. `sectionLine` must precede `pairLine`: `[a] = b`
// is a valid pair line whose key is `[a]`, but the section reading is the
// natural one, and more importantly a `[name]` line fails `pairLine`
// outright (there is no `=`), so trying the section first is also what
// lets `[name]` parse at all. `blankLine` goes last -- it can match
// almost anything's prefix shape but the content lines are more specific.
const line = choice(sectionLine, pairLine, blankLine);

// The whole document: every line must be accounted for, then EOF guards
// against a malformed last line being silently dropped.
const iniParser: Parser<IniLine[]> = map(
  seq(zeroOrMore(line), EOF),
  ([lines]) => lines,
);

/**
 * Parse an INI document into {@link IniData}.
 *
 * @param input - The INI text to parse
 * @returns Globals and sections assembled from the document
 * @throws Error when the input is not well-formed INI
 *
 * @example
 * ```typescript
 * const data = parseINI(`
 * host = example.com
 *
 * [auth]
 * user = admin
 * `);
 * // data.globals  -> { host: "example.com" }
 * // data.sections -> { auth: { user: "admin" } }
 * ```
 */
export const parseINI = (input: string): IniData => {
  const result = parse(iniParser)(input);

  if (!result.success) {
    throw new Error(`INI parse error: ${result.error.message}`);
  }

  return assembleIniData(result.val);
};

/**
 * Fold a stream of classified {@link IniLine}s into {@link IniData}.
 *
 * Shared by the hand-written parser above and the `.tpeg`-generated
 * twin (`ini.tpeg` produces the same line stream), so the assembly rules
 * -- global-vs-section placement, `__proto__`-safe stores, last-wins on
 * repeated keys -- live in exactly one place.
 */
export const assembleIniData = (lines: readonly IniLine[]): IniData => {
  const data: IniData = { globals: {}, sections: {} };
  let current: Record<string, string> = data.globals;

  for (const item of lines) {
    if (item.type === "section") {
      // `data.sections[name] ??= {}` would read the `__proto__` GETTER
      // for a section literally named `[__proto__]` and then store keys
      // on Object.prototype -- same fix as the JSON/CSV samples: check
      // own-ness explicitly and define the property as data.
      if (!Object.hasOwn(data.sections, item.name)) {
        Object.defineProperty(data.sections, item.name, {
          value: {},
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      current = data.sections[item.name] as Record<string, string>;
    } else if (item.type === "pair") {
      // Same `__proto__` concern for a `__proto__ = x` line: assign via
      // defineProperty so it lands as an own data property, not through
      // the inherited setter. A repeated key simply redefines the value
      // (last one wins), which is the conventional INI rule.
      Object.defineProperty(current, item.key, {
        value: item.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }

  return data;
};

/**
 * INI has no escaping or quoting, so some strings simply cannot be
 * written in a form {@link parseINI} reads back unchanged. Writing them
 * anyway silently corrupted the data (a padded value came back trimmed,
 * `v # note` came back as `v`, a key containing `=` split into a
 * different key/value pair, a newline broke the document), so
 * {@link formatINI} rejects them instead.
 */
const unrepresentable = (what: string, text: string, why: string): Error =>
  new Error(
    `formatINI: ${what} ${JSON.stringify(text)} cannot be written as INI -- ${why}`,
  );

const hasLineBreak = (text: string): boolean => /[\r\n]/.test(text);
const isPadded = (text: string): boolean => text !== text.trim();

const formatSectionHeader = (name: string): string => {
  if (hasLineBreak(name) || name.includes("]")) {
    throw unrepresentable(
      "section name",
      name,
      "it contains a line break or ']'",
    );
  }
  if (isPadded(name)) {
    throw unrepresentable(
      "section name",
      name,
      "surrounding whitespace is trimmed on read",
    );
  }
  return `[${name}]`;
};

const formatPair = (key: string, value: string): string => {
  if (key.trim() === "" || hasLineBreak(key) || key.includes("=")) {
    throw unrepresentable(
      "key",
      key,
      "a key must be non-blank and contain no line break or '='",
    );
  }
  if (isPadded(key) || /^[[;#]/.test(key)) {
    throw unrepresentable(
      "key",
      key,
      "surrounding whitespace is trimmed on read, and a leading '[', ';' or '#' starts a section or comment",
    );
  }
  if (hasLineBreak(value)) {
    throw unrepresentable("value", value, "it contains a line break");
  }
  if (isPadded(value)) {
    throw unrepresentable(
      "value",
      value,
      "surrounding whitespace is trimmed on read",
    );
  }
  if (/[ \t][;#]/.test(value)) {
    throw unrepresentable(
      "value",
      value,
      "whitespace followed by ';' or '#' starts an inline comment",
    );
  }
  return `${key} = ${value}`;
};

/**
 * Serialize {@link IniData} back to INI text.
 *
 * Useful for testing round trips and for writing config files. Keys are
 * emitted in object-insertion order, globals first, matching the shape
 * {@link parseINI} produces.
 *
 * @param data - The parsed INI structure to serialize
 * @returns INI text ending with a trailing newline per line
 * @throws Error when a key, value, or section name cannot be written so
 *   that {@link parseINI} reads it back unchanged (INI has no escaping)
 */
export const formatINI = (data: IniData): string => {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data.globals)) {
    lines.push(formatPair(key, value));
  }

  for (const [name, entries] of Object.entries(data.sections)) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(formatSectionHeader(name));
    for (const [key, value] of Object.entries(entries)) {
      lines.push(formatPair(key, value));
    }
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
};

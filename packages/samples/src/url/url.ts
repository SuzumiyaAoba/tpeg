import { takeUntil } from "@suzumiyaaoba/tpeg-combinator";
import {
  type Parser,
  any,
  anyChar,
  charClass,
  choice,
  commit,
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
 * URL Parser Sample
 *
 * Parses absolute URLs into their components:
 *
 *   scheme://userinfo@host:port/path?query#fragment
 *
 * with `userinfo@`, `:port`, `?query`, and `#fragment` all optional.
 * This is a teaching-oriented subset of RFC 3986: IPv6 literals
 * (`http://[::1]/`) and scheme-relative URLs (`//host/path`) are not
 * supported, and components are captured as raw text rather than
 * percent-decoded (see {@link parseQueryParams} for decoding).
 */

/**
 * The decomposed parts of an absolute URL.
 */
export interface UrlParts {
  /** e.g. `"https"` -- always present, always lowercase in practice. */
  readonly scheme: string;
  /** Text before `@` in the authority, when present (e.g. `"user:pw"`). */
  readonly userinfo?: string;
  /** Host name or IPv4 literal -- present only for a `//` authority URL. */
  readonly host?: string;
  /** Port number after `:` in the authority, when present. */
  readonly port?: number;
  /** Everything between the authority and `?`/`#` (`""` when absent). */
  readonly path: string;
  /** Raw query text after `?`, without the `?`. */
  readonly query?: string;
  /** Fragment text after `#`, without the `#`. */
  readonly fragment?: string;
}

// Characters that delimit a URL component. `?` ends the path, `#` ends
// the query, and `/` ends the authority.
const digit = charClass(["0", "9"]);
const alpha = charClass(["a", "z"], ["A", "Z"]);

// scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
const scheme = map(
  seq(alpha, zeroOrMore(choice(alpha, digit, charClass("+", "-", ".")))),
  ([first, rest]) => first + rest.join(""),
);

// userinfo = *( unreserved / pct-encoded / sub-delims / ":" ) "@" -- the
// excluded set keeps it from overrunning into host/path/query/fragment,
// and whitespace is excluded so `//a b@h` can't hide a space in the
// userinfo.
const userinfo = map(
  oneOrMore(negatedCharClass("@", "/", "?", "#", " ", "\t", "\n", "\r")),
  (chars) => chars.join(""),
);

// host -- reg-name or IPv4; stops at the port `:`, path `/`, `?`, `#`,
// `@` (which belongs to a userinfo that precedes it), or whitespace.
const host = map(
  oneOrMore(negatedCharClass(":", "/", "?", "#", "@", " ", "\t", "\n", "\r")),
  (chars) => chars.join(""),
);

// port = *DIGIT -- decoded to a number here rather than downstream.
const port = map(oneOrMore(digit), (chars) => Number(chars.join("")));

// authority = [ userinfo "@" ] host [ ":" port ] -- the "//" itself is
// consumed by the caller's choice alternative so `commit` can wrap this
// body (see urlParser below).
const authority = map(
  seq(
    optional(map(seq(userinfo, literal("@")), ([info]) => info)),
    host,
    optional(map(seq(literal(":"), port), ([, p]) => p)),
  ),
  ([info, hostname, portNum]) => ({
    ...(info !== null ? { userinfo: info } : {}),
    host: hostname,
    ...(portNum !== null ? { port: portNum } : {}),
  }),
);

// path-abempty = *( "/" segment ) -- after an authority the path is
// either empty or starts with `/`.
const pathAbempty = map(
  optional(seq(literal("/"), takeUntil(choice(literal("?"), literal("#"))))),
  (m) => (m === null ? "" : `/${m[1]}`),
);

// path-rootless / path-empty -- an opaque path with no `//` authority,
// as in `mailto:user@example.com`. Raw text up to `?` or `#`.
const pathAny = takeUntil(choice(literal("?"), literal("#")));

// query = *( pchar / "/" / "?" ) -- raw text up to `#` (or end of input).
const query = map(
  seq(literal("?"), takeUntil(literal("#"))),
  ([, text]) => text,
);

// fragment = *( pchar / "/" / "?" ) -- runs to end of input, so "rest of
// the string" is just every remaining character joined.
const fragment = map(seq(literal("#"), zeroOrMore(anyChar())), ([, chars]) =>
  chars.join(""),
);

// End of input -- the grammar's takeUntil chains already guarantee full
// consumption by construction, but an explicit check keeps that true if
// the component parsers ever change.
const EOF = not(any);

// absolute-URI = scheme ":" ( "//" authority path-abempty
//                           / path-rootless )
//                [ "?" query ] [ "#" fragment ]
//
// Once `//` has matched, `commit` makes a failure inside the
// authority/path fatal: without it `x://host:abc` (a non-numeric port)
// would fall through to the opaque-path alternative and parse as
// `{ path: "//host:abc" }` instead of being rejected.
const urlParser: Parser<UrlParts> = map(
  seq(
    scheme,
    literal(":"),
    choice(
      map(
        seq(literal("//"), commit(seq(authority, pathAbempty))),
        ([, [auth, pathname]]) => ({ auth, path: pathname }),
      ),
      map(pathAny, (p) => ({ auth: null, path: p })),
    ),
    optional(query),
    optional(fragment),
    EOF,
  ),
  ([schemeName, , tail, queryText, fragmentText]) => ({
    scheme: schemeName,
    // Spreading `null` contributes nothing, so the authority-less branch
    // needs no empty-object fallback.
    ...tail.auth,
    path: tail.path,
    ...(queryText !== null ? { query: queryText } : {}),
    ...(fragmentText !== null ? { fragment: fragmentText } : {}),
  }),
);

/**
 * Parse an absolute URL into {@link UrlParts}.
 *
 * @param input - The URL text to parse
 * @returns The decomposed URL
 * @throws Error when the input is not a well-formed absolute URL
 *
 * @example
 * ```typescript
 * parseUrl("https://user@example.com:8443/a/b?x=1#top");
 * // { scheme: "https", userinfo: "user", host: "example.com",
 * //   port: 8443, path: "/a/b", query: "x=1", fragment: "top" }
 * ```
 */
export const parseUrl = (input: string): UrlParts => {
  const result = parse(urlParser)(input);

  if (!result.success) {
    throw new Error(`URL parse error: ${result.error.message}`);
  }

  return result.val;
};

/**
 * Parse a query string into key/value pairs.
 *
 * `a=1&b=2&c` -> `{ a: "1", b: "2", c: "" }`. Percent-escapes and `+` are
 * decoded; a malformed `%` escape is left as-is rather than throwing.
 * A repeated key keeps the LAST value (matching `URLSearchParams`'s
 * single-value read).
 *
 * @param query - Raw query text (without the `?`)
 * @returns Decoded key/value pairs
 */
export const parseQueryParams = (query: string): Record<string, string> => {
  const params: Record<string, string> = {};

  const decode = (text: string): string => {
    try {
      return decodeURIComponent(text.replace(/\+/g, " "));
    } catch {
      return text;
    }
  };

  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    // `__proto__` as a parameter name must land as data, not hit the
    // inherited setter -- same fix as the JSON/CSV samples.
    Object.defineProperty(params, decode(rawKey), {
      value: decode(rawValue),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return params;
};

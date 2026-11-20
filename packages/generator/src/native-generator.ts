import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GrammarDefinition } from "@suzumiyaaoba/tpeg-core";
import { Eta } from "eta";
import {
  portableGrammar,
  type PortableGrammar,
  type PortableNode,
} from "./portable-grammar";

export const nativeExtensions = {
  python: ".py",
  go: ".go",
  rust: ".rs",
} as const;
export type NativeLanguage = keyof typeof nativeExtensions;

export const isNativeLanguage = (
  language: string,
): language is NativeLanguage => Object.hasOwn(nativeExtensions, language);

export interface NativeCodeGenOptions {
  namePrefix?: string;
  /** Additional declarations/imports, emitted before parser data. */
  header?: string;
  /** Go package name (default: parser). */
  packageName?: string;
}

export interface NativeGeneratedCode {
  code: string;
  exports: string[];
  warnings: string[];
  language: NativeLanguage;
  extension: string;
}

const quote = JSON.stringify;
/** Go permits a BOM in a string value when it is escaped in the source. */
export const goStringLiteral = (value: string): string =>
  quote(value).replaceAll("\uFEFF", "\\uFEFF");

const units = (value: string): string =>
  Array.from({ length: value.length }, (_, index) =>
    value.charCodeAt(index),
  ).join(", ");

export function rustStringLiteral(value: string): string {
  return (
    '"' +
    Array.from(value, (char) => {
      if (char === '"') return '\\"';
      if (char === "\\") return "\\\\";
      if (char === "\n") return "\\n";
      if (char === "\r") return "\\r";
      if (char === "\t") return "\\t";
      const cp = char.codePointAt(0)!;
      // Rust requires directional controls in literals to be escaped.
      return cp < 32 || cp === 127 || /\p{Cf}/u.test(char)
        ? `\\u{${cp.toString(16)}}`
        : char;
    }).join("") +
    '"'
  );
}

function goNode(node: PortableNode): string {
  return `{kind: ${goStringLiteral(node.kind)}, children: []int{${node.children.join(", ")}}, text: ${goStringLiteral(node.text)}, literal: []uint16{${node.kind === "StringLiteral" ? units(node.text) : ""}}, ranges: [][2]rune{${node.ranges.map(([low, high]) => `{${low}, ${high}}`).join(", ")}}, min: ${node.min}, max: ${node.max}, flag: ${node.flag}}`;
}

function rustNode(node: PortableNode): string {
  return `Node { kind: ${rustStringLiteral(node.kind)}, children: &[${node.children.join(", ")}], text: ${rustStringLiteral(node.text)}, literal: &[${node.kind === "StringLiteral" ? units(node.text) : ""}], ranges: &[${node.ranges.map(([low, high]) => `(${low}, ${high})`).join(", ")}], min: ${node.min}, max: ${node.max}, flag: ${node.flag} }`;
}

const reservedParameters = {
  python: new Set(
    "__debug__ False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(
      " ",
    ),
  ),
  go: new Set(
    "break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var".split(
      " ",
    ),
  ),
  rust: new Set(
    "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try".split(
      " ",
    ),
  ),
};

function transformSource(
  grammar: GrammarDefinition,
  language: NativeLanguage,
): string {
  const functions =
    grammar.transforms?.find(
      (definition) => definition.transformSet.targetLanguage === language,
    )?.transformSet.functions ?? [];
  const declarations: string[] = [];
  const bindings: string[] = [];
  for (const [index, fn] of functions.entries()) {
    const parameter = fn.parameters[0]?.name ?? "_captures";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parameter))
      throw new Error(`Invalid ${language} transform parameter: ${parameter}`);
    if (reservedParameters[language].has(parameter))
      throw new Error(`Reserved ${language} transform parameter: ${parameter}`);
    const name = `_tpeg_transform_${index}`;
    if (language === "python") {
      declarations.push(
        `${name} = _compile_transform(${quote(name)}, ${quote(parameter)}, ${quote(fn.body)})`,
      );
      bindings.push(`${quote(fn.name)}: ${name}`);
    } else if (language === "go") {
      declarations.push(
        `func ${name}(${parameter} any) TransformResult {\n${fn.body}\n}`,
      );
      bindings.push(`${goStringLiteral(fn.name)}: ${name}`);
    } else {
      declarations.push(
        `fn ${name}(${parameter}: Value) -> Result<Value, String> {\n${fn.body}\n}`,
      );
      bindings.push(
        `${rustStringLiteral(fn.name)} => Some(${name} as Transform)`,
      );
    }
  }
  if (language === "python")
    return `${declarations.join("\n\n")}\n\n_TRANSFORMS = {${bindings.join(", ")}}`;
  if (language === "go")
    return `${declarations.join("\n\n")}\n\nvar defaultTransforms = map[string]Transform{${bindings.join(", ")}}`;
  return `${declarations.join("\n\n")}\n\nfn default_transform(name: &str) -> Option<Transform> { match name { ${bindings.map((binding) => `${binding},`).join(" ")} _ => None } }`;
}

function grammarTemplateData(
  grammar: PortableGrammar,
  language: NativeLanguage,
) {
  if (language === "python") return { grammarLiteral: quote(quote(grammar)) };

  const go = language === "go";
  const nodes = grammar.nodes.map(go ? goNode : rustNode);
  const rules = grammar.rules.map(({ name, node, memoize, memoLimit }) =>
    go
      ? `${goStringLiteral(name)}: {node: ${node}, memoize: ${memoize}, limit: ${memoLimit}}`
      : `${rustStringLiteral(name)} => Some((${node}, ${memoize}, ${memoLimit}))`,
  );
  return {
    nodes: nodes.join(",\n"),
    rules: rules.join(",\n"),
    start: go
      ? goStringLiteral(grammar.start)
      : rustStringLiteral(grammar.start),
  };
}

/** Generate a dependency-free native parser, using the target's Eta template. */
export function generateNativeParser(
  grammar: GrammarDefinition,
  language: NativeLanguage,
  options: NativeCodeGenOptions = {},
): NativeGeneratedCode {
  const portable = portableGrammar(grammar);
  if (
    language !== "python" &&
    portable.nodes.some(
      (node) =>
        node.kind === "StringLiteral" && /[\uD800-\uDFFF]/u.test(node.text),
    )
  )
    throw new Error(
      `${language} string literals must contain Unicode scalar values; unpaired surrogates cannot be represented by the native string type`,
    );
  const prefix = options.namePrefix ?? "";
  if (prefix && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix))
    throw new Error("namePrefix must be an identifier prefix");
  const packageName = options.packageName ?? "parser";
  if (
    language === "go" &&
    (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(packageName) ||
      packageName === "_" ||
      reservedParameters.go.has(packageName))
  )
    throw new Error("packageName must be a Go package identifier");
  const parseName = prefix + (language === "go" ? "Parse" : "parse");
  const eta = new Eta({
    views: resolve(dirname(fileURLToPath(import.meta.url)), "../templates"),
    autoTrim: false,
  });
  const code = eta.render(`${language}/parser`, {
    header: options.header ?? "",
    packageName,
    parseName,
    ...grammarTemplateData(portable, language),
    transforms: transformSource(grammar, language),
  });
  return {
    code,
    language,
    extension: nativeExtensions[language],
    exports: [parseName],
    warnings: [],
  };
}

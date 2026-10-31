import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GrammarDefinition } from "@suzumiyaaoba/tpeg-core";
import { Eta } from "eta";
import { portableGrammar, type PortableNode } from "./portable-grammar";

export type NativeLanguage = "python" | "go" | "rust";

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
      return cp < 32 || cp === 127 ? `\\u{${cp.toString(16)}}` : char;
    }).join("") +
    '"'
  );
}

function goNode(node: PortableNode): string {
  return `{kind: ${quote(node.kind)}, children: []int{${node.children.join(", ")}}, text: ${quote(node.kind === "StringLiteral" ? "" : node.text)}, literal: []uint16{${units(node.text)}}, ranges: [][2]rune{${node.ranges.map(([low, high]) => `{${low}, ${high}}`).join(", ")}}, min: ${node.min}, max: ${node.max}, flag: ${node.flag}}`;
}

function rustNode(node: PortableNode): string {
  return `Node { kind: ${rustStringLiteral(node.kind)}, children: &[${node.children.join(", ")}], text: ${rustStringLiteral(node.kind === "StringLiteral" ? "" : node.text)}, literal: &[${units(node.text)}], ranges: &[${node.ranges.map(([low, high]) => `(${low}, ${high})`).join(", ")}], min: ${node.min}, max: ${node.max}, flag: ${node.flag} }`;
}

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
    const keywords =
      language === "python"
        ? "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield"
        : language === "go"
          ? "break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var"
          : "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try";
    if (keywords.split(" ").includes(parameter))
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
      bindings.push(`${quote(fn.name)}: ${name}`);
    } else {
      declarations.push(
        `fn ${name}(${parameter}: Value) -> Result<Value, String> {\n${fn.body}\n}`,
      );
      bindings.push(`${quote(fn.name)} => Some(${name} as Transform)`);
    }
  }
  if (language === "python")
    return `${declarations.join("\n\n")}\n\n_TRANSFORMS = {${bindings.join(", ")}}`;
  if (language === "go")
    return `${declarations.join("\n\n")}\n\nvar defaultTransforms = map[string]Transform{${bindings.join(", ")}}`;
  return `${declarations.join("\n\n")}\n\nfn default_transform(name: &str) -> Option<Transform> { match name { ${bindings.map((binding) => `${binding},`).join(" ")} _ => None } }`;
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
      "_ break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var"
        .split(" ")
        .includes(packageName))
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
    grammarLiteral: quote(quote(portable)),
    nodes: portable.nodes
      .map(language === "go" ? goNode : rustNode)
      .join(",\n"),
    rules: portable.rules
      .map((rule) =>
        language === "go"
          ? `${quote(rule.name)}: {node: ${rule.node}, memoize: ${rule.memoize}, limit: ${rule.memoLimit}}`
          : `${quote(rule.name)} => Some((${rule.node}, ${rule.memoize}, ${rule.memoLimit}))`,
      )
      .join(",\n"),
    start: quote(portable.start),
    transforms: transformSource(grammar, language),
  });
  return {
    code,
    language,
    extension: { python: ".py", go: ".go", rust: ".rs" }[language],
    exports: [parseName],
    warnings: [],
  };
}

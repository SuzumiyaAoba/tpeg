import { createRequire } from "node:module";
import type { Parser } from "@suzumiyaaoba/tpeg-core";
import {
  advanceJsSlash,
  advanceJsToken,
  createJsExprTracker,
  isJsIdentifierStart,
  scanJsWord,
  skipBlockComment,
  skipLineComment,
  skipStringLiteral,
} from "./brace-scanner";

const nativeRequire = createRequire(import.meta.url);
const sourceKey = Symbol.for(
  "@suzumiyaaoba/tpeg-parser/native-evaluation-source",
);
type NativeEvaluator = typeof import("../runtime/native-evaluator.mjs").default;
let nativeEvaluator: NativeEvaluator | undefined;
let lastHelperBindings:
  | { names: readonly string[]; bindings: string; shadowsGlobalRead: boolean }
  | undefined;

/** Cache only the last key layout; helper values are captured on every call. */
function helperBindings(names: readonly string[]) {
  const previous = lastHelperBindings;
  if (
    previous?.names.length === names.length &&
    names.every((name, index) => name === previous.names[index])
  ) {
    return previous;
  }
  let shadowsGlobalRead = false;
  const bindings = names
    .map((name) => {
      const { word, end } = scanJsWord(name, 0);
      if (word === "globalThis" || word === "Symbol") shadowsGlobalRead = true;
      return word === name && end === name.length
        ? name
        : `${JSON.stringify(name)}: ${name}`;
    })
    .join(", ");
  lastHelperBindings = { names, bindings, shadowsGlobalRead };
  return lastHelperBindings;
}

/** Restore staged compiler input before generated module initialization. */
function withEvaluationValue<T>(
  value: unknown,
  run: (evaluate: () => unknown) => T,
): T {
  nativeEvaluator ??= nativeRequire("../runtime/native-evaluator.mjs")
    .default as NativeEvaluator;
  const [getGlobal, evaluate] = nativeEvaluator;
  const global = getGlobal();
  const previous = Object.getOwnPropertyDescriptor(global, sourceKey);
  Object.defineProperty(global, sourceKey, {
    value,
    configurable: true,
  });
  try {
    return run(evaluate);
  } finally {
    if (previous) {
      Object.defineProperty(global, sourceKey, previous);
    } else {
      Reflect.deleteProperty(global, sourceKey);
    }
  }
}

type ModuleFactory = () => Record<string, unknown>;

/** Compile an arrow in an isolated native module, keeping the API synchronous. */
function compileFactory(source: string): () => ModuleFactory {
  const bind = withEvaluationValue(source, (evaluate) =>
    evaluate.call(undefined),
  );
  if (typeof bind !== "function") {
    throw new Error("Generated parser factory did not evaluate to a function");
  }
  return bind as () => ModuleFactory;
}

/**
 * Execute the JavaScript emitted by our generators against injected helpers.
 * Only generated core/combinator imports are supported. Module declarations
 * are inspected only outside strings, comments and nested code;
 * action text must remain byte-for-byte intact. This is shared by the
 * differential and benchmark harnesses, not a general module loader.
 */
export function evaluateGeneratedModule(
  code: string,
  scope: Record<string, unknown>,
): Record<string, unknown>;
export function evaluateGeneratedModule<N extends string>(
  code: string,
  scope: Record<string, unknown>,
  ruleNames: readonly N[],
): Record<N, Parser<unknown>>;
export function evaluateGeneratedModule(
  code: string,
  scope: Record<string, unknown>,
  ruleNames?: readonly string[],
): Record<string, unknown> {
  const exports: { local: string; name: string }[] = [];
  const parts: string[] = [];
  const tracker = createJsExprTracker(true);
  let depth = 0;
  let cursor = 0;
  let i = 0;

  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipStringLiteral(code, i, ch);
      tracker.operand();
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      i = skipLineComment(code, i);
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      i = skipBlockComment(code, i, tracker);
      continue;
    }
    if (ch === "/") {
      i = advanceJsSlash(code, i, tracker);
      continue;
    }
    if (isJsIdentifierStart(code, i)) {
      const { word, end } = scanJsWord(code, i);
      if (depth === 0 && word === "import" && !tracker.propertyPosition) {
        const declaration =
          /^import\s*\{([^}]*)\}\s*from\s*"@suzumiyaaoba\/tpeg-(?:core|combinator)"\s*;/.exec(
            code.slice(i),
          );
        if (!declaration) {
          throw new Error(`Unsupported generated import at offset ${i}`);
        }
        for (const item of (declaration[1] ?? "").split(",")) {
          const name = item.trim();
          if (!name) continue;
          if (!/^[a-zA-Z_$][\w$]*$/.test(name) || !Object.hasOwn(scope, name)) {
            throw new Error(`Missing generated import binding "${name}"`);
          }
        }
        parts.push(code.slice(cursor, i));
        cursor = i + declaration[0].length;
        i = cursor;
        tracker.punct(";");
        continue;
      }
      if (depth === 0 && word === "export" && !tracker.propertyPosition) {
        const tail = code.slice(i);
        const declaration = /^export\s+const\s+([a-zA-Z_$][\w$]*)/.exec(tail);
        if (declaration?.[1]) {
          exports.push({ local: declaration[1], name: declaration[1] });
          parts.push(code.slice(cursor, i));
          // Only remove the keyword; preserve the declaration and its body.
          cursor = end;
          i = end;
          continue;
        }

        const aliases = /^export\s*\{([^}]*)\}\s*;?/.exec(tail);
        if (!aliases) {
          throw new Error(`Unsupported generated export at offset ${i}`);
        }
        for (const item of (aliases[1] ?? "").split(",")) {
          if (!item.trim()) continue;
          const alias =
            /^\s*([a-zA-Z_$][\w$]*)(?:\s+as\s+([a-zA-Z_$][\w$]*))?\s*$/.exec(
              item,
            );
          if (!alias?.[1]) {
            throw new Error(`Unsupported generated export at offset ${i}`);
          }
          exports.push({ local: alias[1], name: alias[2] ?? alias[1] });
        }
        parts.push(code.slice(cursor, i), ";");
        cursor = i + aliases[0].length;
        i = cursor;
        tracker.punct(";");
        continue;
      }
      tracker.word(word);
      i = end;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    i = advanceJsToken(code, i, tracker);
  }
  parts.push(code.slice(cursor));

  // An alias is an export-table key, not a new lexical declaration.
  // Computed keys keep __proto__ an ordinary own property too. The table
  // has no prototype, so missing constructor/toString cannot become rules.
  const returned = exports
    .map(({ name, local }) => `[${JSON.stringify(name)}]: ${local}`)
    .join(", ");
  // The anonymous native-module evaluator gives both arrows module-level
  // this/arguments/new.target semantics without exposing loader locals.
  // The inner scope still permits rules to shadow unused helper bindings.
  const names = Object.keys(scope);
  const { bindings, shadowsGlobalRead } = helperBindings(names);
  const stagedValues =
    'globalThis[Symbol.for("@suzumiyaaoba/tpeg-parser/native-evaluation-source")]';
  // Use global eval only when a helper would put the ordinary read in
  // its own TDZ. Decode identifier escapes too. Strict bindings cannot
  // be named eval, so that builtin remains available for this fallback.
  const readValues = shadowsGlobalRead
    ? `(0, eval)(${JSON.stringify(stagedValues)})`
    : stagedValues;
  const bind = compileFactory(
    `() => { const { ${bindings} } = ${readValues}; return () => { return (() => {\n${parts.join("")}\nreturn { __proto__: null, ${returned} };\n})(); }; }`,
  );
  // Capture getters outside the staging slot, by name rather than index.
  // Deleting another helper while reading a getter must not shift bindings.
  const values: Record<string, unknown> = { __proto__: null };
  for (const [name, value] of Object.entries(scope)) values[name] = value;
  const factory = withEvaluationValue(values, () => bind());
  const module = factory();
  if (ruleNames === undefined) return module;
  const rules: Record<string, unknown> = { __proto__: null };
  for (const name of ruleNames) {
    const rule = module[name];
    if (typeof rule !== "function") {
      throw new Error(`Generated module did not produce parser rule "${name}"`);
    }
    rules[name] = rule;
  }
  return rules;
}

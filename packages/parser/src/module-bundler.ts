import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  mapChildExpressions,
  selectTransformSets,
  type Expression,
  type GrammarDefinition,
  type ModularGrammarDefinition,
  type ModuleFile,
  type RuleDefinition,
  type TransformDefinition,
  type TransformFunction,
  type TransformSet,
} from "@suzumiyaaoba/tpeg-core";
import { parseGrammarFile } from "./grammar-file";
import {
  validateGrammar,
  validateGrammarDeclarations,
} from "./grammar-validation";
import { CircularDependencyError } from "./module-resolver";
import { NamespaceManager } from "./namespace-manager";
import { moduleNameFromPath } from "./path-utils";
import { applySkipDesugar } from "./skip-desugar";
import { VersionManager } from "./version-manager";
import { createTransformDefinition, createTransformSet } from "./types";

interface RuleSource {
  rule: RuleDefinition;
  owner: string;
  transforms: Map<TransformSet["targetLanguage"], TransformFunction>;
}
interface LinkedModule {
  rules: Map<string, RuleSource>;
  exports: string[];
  grammar: GrammarDefinition | ModularGrammarDefinition;
}

/** Link imports and inheritance into one grammar, suitable for every backend. */
export function bundleGrammarModules(
  entry: ModuleFile,
  dependencies: readonly ModuleFile[],
): GrammarDefinition {
  const files = [
    entry,
    ...dependencies.filter(
      (file) => resolve(file.filePath) !== resolve(entry.filePath),
    ),
  ];
  const byPath = new Map<string, string>();
  const byName = new Map<string, ModuleFile>();
  for (const [index, file] of files.entries()) {
    const path = resolve(file.filePath);
    if (byPath.has(path)) throw new Error(`Module supplied twice: ${path}`);
    if (file.grammars.length !== 1)
      throw new Error(`Expected one grammar in ${file.filePath}`);
    const name = `__tpeg_module_${index}`;
    byPath.set(path, name);
    byName.set(name, file);
  }
  const rootName = byPath.get(resolve(entry.filePath))!;
  for (const file of files)
    for (const statement of file.imports) {
      if (!byPath.has(resolve(dirname(file.filePath), statement.modulePath)))
        throw new Error(
          `Missing imported module "${statement.modulePath}" from ${file.filePath}`,
        );
    }
  const versions = new VersionManager();
  for (const file of files) {
    // @requires constrains already-loaded modules; it is not an implicit
    // filesystem import. VersionManager resolves paths relative to the owner.
    versions.registerModule({
      ...file,
      imports: [
        ...file.imports,
        ...Object.entries(file.moduleInfo?.requires ?? {}).map(
          ([modulePath, version]) => ({
            type: "ImportStatement" as const,
            modulePath,
            version,
          }),
        ),
      ],
    });
  }
  versions.validateAllDependencies();
  const effective = new Map<string, LinkedModule>();
  const building = new Set<string>();

  function imported(name: string, reference: string): string {
    const file = byName.get(name)!;
    const dot = reference.indexOf(".");
    const candidates = file.imports.filter((statement) => {
      if (dot >= 0)
        return (
          (statement.alias ?? moduleNameFromPath(statement.modulePath)) ===
          reference.slice(0, dot)
        );
      const target = byPath.get(
        resolve(dirname(file.filePath), statement.modulePath),
      );
      return (
        target !== undefined &&
        byName.get(target)!.grammars[0]!.name === reference
      );
    });
    if (candidates.length !== 1)
      throw new Error(
        `Cannot resolve inherited grammar "${reference}" in ${file.filePath}`,
      );
    const target = byPath.get(
      resolve(dirname(file.filePath), candidates[0]!.modulePath),
    );
    if (!target) throw new Error(`Missing module ${candidates[0]!.modulePath}`);
    if (
      dot >= 0 &&
      byName.get(target)!.grammars[0]!.name !== reference.slice(dot + 1)
    )
      throw new Error(`Imported grammar does not match "${reference}"`);
    return target;
  }

  function link(name: string): LinkedModule {
    const previous = effective.get(name);
    if (previous) return previous;
    if (building.has(name))
      throw new Error(
        `Circular grammar inheritance in ${byName.get(name)!.filePath}`,
      );
    building.add(name);
    const file = byName.get(name)!;
    const grammar = file.grammars[0]!;
    const own = new Map<string, RuleSource>();
    for (const rule of grammar.rules) {
      if (own.has(rule.name))
        throw new Error(`Duplicate rule "${rule.name}" in ${file.filePath}`);
      own.set(rule.name, { rule, owner: name, transforms: new Map() });
    }
    const rules = new Map(own);
    const exported = new Set(own.keys());
    let inheritedStart: GrammarDefinition["annotations"][number] | undefined;
    const parents =
      grammar.type === "ModularGrammarDefinition"
        ? [
            ...(grammar.extends ? [grammar.extends] : []),
            ...(grammar.includes ?? []),
          ]
        : [];
    for (const reference of parents) {
      const parent = link(imported(name, reference));
      inheritedStart ??= parent.grammar.annotations.find(
        (annotation) => annotation.key === "start",
      );
      for (const [ruleName, source] of parent.rules) {
        if (own.has(ruleName)) continue;
        const conflict = rules.get(ruleName);
        if (
          conflict &&
          (conflict.owner !== source.owner ||
            conflict.transforms.size !== source.transforms.size ||
            [...conflict.transforms].some(
              ([language, fn]) => source.transforms.get(language) !== fn,
            ))
        )
          throw new Error(
            `Inherited rule "${ruleName}" is ambiguous in ${file.filePath}; define an override`,
          );
        rules.set(ruleName, source);
      }
      for (const ruleName of parent.exports) exported.add(ruleName);
    }
    const linkedGrammar =
      inheritedStart &&
      grammar.rules.length === 0 &&
      !grammar.annotations.some((annotation) => annotation.key === "start")
        ? { ...grammar, annotations: [...grammar.annotations, inheritedStart] }
        : grammar;
    const plain: GrammarDefinition = {
      ...linkedGrammar,
      type: "GrammarDefinition",
      rules: [...rules.values()].map((source) => source.rule),
    };
    // Inherited transforms and qualified references are resolved in the final
    // grammar. Control flow can only be checked with those bindings in place.
    validateGrammarDeclarations(plain);
    const desugared = applySkipDesugar(plain);
    // Whitespace policy belongs to the module that defines a rule. An
    // inherited rule retains its original policy; an override uses its own.
    for (const rule of desugared.rules) {
      if (own.has(rule.name))
        rules.set(rule.name, { ...own.get(rule.name)!, rule });
    }
    for (const [language, set] of selectTransformSets(grammar)) {
      for (const fn of set.functions) {
        const source = rules.get(fn.name)!;
        // A child may override a transform on an inherited rule without
        // changing the parser or transform bindings stored in its parent.
        const transforms = new Map(source.transforms);
        transforms.set(language, fn);
        rules.set(fn.name, { ...source, transforms });
      }
    }
    const result = {
      rules,
      exports:
        grammar.type === "ModularGrammarDefinition" && grammar.exports
          ? grammar.exports.rules
          : [...exported],
      grammar: linkedGrammar,
    };
    effective.set(name, result);
    building.delete(name);
    return result;
  }
  for (const name of byName.keys()) link(name);

  const namespaces = new NamespaceManager();
  for (const [name, file] of byName) {
    const module = effective.get(name)!;
    namespaces.registerModule({
      ...file,
      moduleInfo: { ...file.moduleInfo, type: "ModuleInfo", namespace: name },
      grammars: [
        {
          ...module.grammar,
          type: "ModularGrammarDefinition",
          rules: [...module.rules.values()].map((source) => source.rule),
          exports: { type: "ExportDeclaration", rules: module.exports },
        },
      ],
    });
  }
  const emitted = new Map<string, Map<string, string>>();
  const used = new Set(effective.get(rootName)!.rules.keys());
  for (const [name, module] of effective) {
    const names = new Map<string, string>();
    for (const [index, ruleName] of [...module.rules.keys()].entries()) {
      let output = name === rootName ? ruleName : `${name}_rule_${index}`;
      if (name !== rootName) {
        while (used.has(output)) output += "_";
        used.add(output);
      }
      names.set(ruleName, output);
    }
    emitted.set(name, names);
  }

  function rewrite(
    expression: Expression,
    context: string,
    owner: string,
  ): Expression {
    if (expression.type === "Identifier") {
      const target = effective.get(owner)!.rules.has(expression.name)
        ? { moduleName: context, rule: { name: expression.name } }
        : namespaces.resolveLocalRule(expression.name, owner);
      return {
        type: "Identifier",
        name: emitted.get(target.moduleName)!.get(target.rule.name)!,
      };
    }
    if (expression.type === "QualifiedIdentifier") {
      const target = namespaces.resolveQualifiedName(expression, owner);
      return {
        type: "Identifier",
        name: emitted.get(target.moduleName)!.get(target.rule.name)!,
      };
    }
    return mapChildExpressions(expression, (child) =>
      rewrite(child, context, owner),
    );
  }

  const rules: RuleDefinition[] = [];
  const transforms = new Map<
    TransformSet["targetLanguage"],
    TransformFunction[]
  >();
  // Emit entry rules first, even if inheritance caused parents to be linked first.
  for (const name of [
    rootName,
    ...[...byName.keys()].filter((name) => name !== rootName),
  ]) {
    const module = effective.get(name)!;
    for (const [ruleName, source] of module.rules) {
      const output = emitted.get(name)!.get(ruleName)!;
      rules.push({
        ...source.rule,
        name: output,
        pattern: rewrite(source.rule.pattern, name, source.owner),
      });
      for (const [target, fn] of source.transforms) {
        const functions = transforms.get(target) ?? [];
        functions.push({ ...fn, name: output });
        transforms.set(target, functions);
      }
    }
  }
  const root = effective.get(rootName)!.grammar;
  const definitions: TransformDefinition[] = [...transforms].map(
    ([targetLanguage, functions]) =>
      createTransformDefinition(
        createTransformSet(
          `Linked_${targetLanguage}`,
          targetLanguage,
          functions,
        ),
      ),
  );
  const grammar: GrammarDefinition = {
    type: "GrammarDefinition",
    name: root.name,
    annotations: root.annotations.filter(
      (annotation) => annotation.key !== "skip",
    ),
    rules,
    transforms: definitions,
  };
  validateGrammar(grammar);
  return grammar;
}

function readModuleFile(path: string): ModuleFile {
  const result = parseGrammarFile(path, readFileSync(path, "utf8"));
  if (!result.success) {
    throw new Error(
      `${path}:${result.line}:${result.column}: ${result.error.message}`,
    );
  }
  return result.val;
}

/**
 * Link a local import graph into a standalone grammar. A caller that has
 * parsed the entry already can pass the file and reuse that same snapshot.
 */
export function bundleGrammarFile(
  entryFile: string | ModuleFile,
): GrammarDefinition {
  const modules = new Map<string, ModuleFile>();
  const active = new Set<string>();
  function resolveImports(path: string, file: ModuleFile): ModuleFile {
    const imports = file.imports.map((statement) => ({
      ...statement,
      alias: statement.alias ?? moduleNameFromPath(statement.modulePath),
      modulePath: realpathSync(resolve(dirname(path), statement.modulePath)),
    }));
    const requires = file.moduleInfo?.requires;
    const moduleInfo = file.moduleInfo
      ? {
          ...file.moduleInfo,
          ...(requires
            ? {
                requires: Object.fromEntries(
                  Object.entries(requires).map(([name, constraint]) => {
                    let target = name;
                    try {
                      target = realpathSync(resolve(dirname(path), name));
                    } catch {
                      /* A module name can be used instead of a file path. */
                    }
                    return [target, constraint];
                  }),
                ),
              }
            : {}),
        }
      : undefined;
    return {
      ...file,
      filePath: path,
      imports,
      ...(moduleInfo ? { moduleInfo } : {}),
    };
  }
  const entry = realpathSync(
    typeof entryFile === "string" ? entryFile : entryFile.filePath,
  );
  const stack: { path: string; module: ModuleFile; next: number }[] = [];
  const push = (path: string, file: ModuleFile) => {
    const module = resolveImports(path, file);
    modules.set(path, module);
    active.add(path);
    stack.push({ path, module, next: 0 });
  };
  push(
    entry,
    typeof entryFile === "string" ? readModuleFile(entry) : entryFile,
  );
  while (stack.length) {
    const frame = stack.at(-1)!;
    const dependency = frame.module.imports[frame.next++];
    if (!dependency) {
      active.delete(frame.path);
      stack.pop();
      continue;
    }
    const path = dependency.modulePath;
    if (active.has(path))
      throw new CircularDependencyError([
        ...stack.map((item) => item.path),
        path,
      ]);
    if (!modules.has(path)) push(path, readModuleFile(path));
  }
  return bundleGrammarModules(modules.get(entry)!, [...modules.values()]);
}

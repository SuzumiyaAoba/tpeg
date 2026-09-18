import type {
  ModularGrammarDefinition,
  ModuleFile,
  QualifiedIdentifier,
} from "@suzumiyaaoba/tpeg-core";
import {
  dirnameOf,
  moduleNameFromPath,
  normalizeModulePath,
} from "./path-utils.js";
import type { RuleDefinition } from "./types.js";

/**
 * Module-name collision error: two different source files derived the
 * same module name (no explicit `@namespace` given to either).
 */
export class ModuleNameCollisionError extends Error {
  constructor(
    public readonly moduleName: string,
    public readonly existingFilePath: string,
    public readonly newFilePath: string,
  ) {
    super(
      `Module name '${moduleName}' is ambiguous: both '${existingFilePath}' and '${newFilePath}' extract to it (registerModule derives a name from the basename when no explicit @namespace is given). Add an explicit @namespace to one of them to disambiguate.`,
    );
    this.name = "ModuleNameCollisionError";
  }
}

/**
 * Namespace conflict error.
 */
export class NamespaceConflictError extends Error {
  constructor(
    public readonly ruleName: string,
    public readonly conflictingModules: string[],
    public readonly currentModule: string,
  ) {
    super(
      `Rule '${ruleName}' conflicts between modules: ${conflictingModules.join(", ")} in module '${currentModule}'`,
    );
    this.name = "NamespaceConflictError";
  }
}

/**
 * `@export` resolution error: an `@export: [...]` declaration listed a
 * rule name that no grammar in the module actually declares. Without this
 * check the phantom name lands in `scope.exports` like a real export --
 * `checkNamespaceConflicts` then counts it as a genuine exporter and can
 * raise a `NamespaceConflictError` against an importing module that
 * legitimately imports ANOTHER module's real rule of the same name (a
 * conflict between a real rule and nothing), and `getAvailableRules`
 * advertises a rule that resolves to no `RuleDefinition`.
 */
export class ExportResolutionError extends Error {
  constructor(
    public readonly ruleName: string,
    public readonly moduleName: string,
    public readonly grammarName: string,
  ) {
    super(
      `Rule '${ruleName}' in @export of grammar '${grammarName}' is not declared in module '${moduleName}' -- @export lists rules to export; every name must match a rule declared in this module.`,
    );
    this.name = "ExportResolutionError";
  }
}

/**
 * Qualified-name resolution error.
 */
export class QualifiedNameResolutionError extends Error {
  constructor(
    public readonly qualifiedName: string,
    public readonly reason: string,
  ) {
    super(`Cannot resolve qualified name '${qualifiedName}': ${reason}`);
    this.name = "QualifiedNameResolutionError";
  }
}

/**
 * Information about a resolved rule.
 */
export interface ResolvedRule {
  rule: RuleDefinition;
  moduleName: string;
  isExported: boolean;
  isLocal: boolean;
}

/**
 * Namespace scope information.
 */
export interface NamespaceScope {
  /** Current module name */
  currentModule: string;
  /** Aliases of imported modules */
  imports: Map<string, string>; // alias -> module name
  /** Exported rule names */
  exports: Set<string>;
  /** Local rule names */
  localRules: Set<string>;
  /** Available rules (module -> rule names) */
  availableRules: Map<string, Set<string>>;
}

/**
 * Namespace management system.
 */
export class NamespaceManager {
  private scopes = new Map<string, NamespaceScope>();
  private moduleRules = new Map<string, Map<string, RuleDefinition>>();
  /** The `filePath` each registered module name was derived from --
   * lets `registerModule` detect two DIFFERENT files silently colliding
   * on the same basename-derived name (see `extractModuleName`'s doc
   * comment) instead of the second registration silently overwriting
   * the first's `scopes`/`moduleRules` entry. */
  private moduleFilePaths = new Map<string, string>();
  /** Selective import lists: module name -> (import alias -> the rule
   * names `import "m.tpeg" { r1, r2 }` brings into scope). Imports
   * without a `{...}` list have no entry here -- they expose everything
   * the target exports via their alias. */
  private selectiveImports = new Map<string, Map<string, Set<string>>>();

  /**
   * Registers a module.
   *
   * @throws {ModuleNameCollisionError} if a DIFFERENT `filePath` was
   *   already registered under the same derived module name (no explicit
   *   `@namespace` on one or both) -- re-registering the SAME `filePath`
   *   (e.g. re-resolving an already-registered module) is not a
   *   collision and simply refreshes its entry.
   * @throws {ExportResolutionError} if any grammar's `@export: [...]`
   *   lists a rule name the module never declares -- see that error's
   *   doc comment for the phantom-export failure mode this prevents.
   */
  registerModule(moduleFile: ModuleFile): void {
    const moduleName =
      moduleFile.moduleInfo?.namespace ||
      this.extractModuleName(moduleFile.filePath);

    const existingFilePath = this.moduleFilePaths.get(moduleName);
    if (
      existingFilePath !== undefined &&
      existingFilePath !== moduleFile.filePath
    ) {
      throw new ModuleNameCollisionError(
        moduleName,
        existingFilePath,
        moduleFile.filePath,
      );
    }
    this.moduleFilePaths.set(moduleName, moduleFile.filePath);

    const scope: NamespaceScope = {
      currentModule: moduleName,
      imports: new Map(),
      exports: new Set(),
      localRules: new Set(),
      availableRules: new Map(),
    };

    // Process imports
    const scopeSelectiveImports = new Map<string, Set<string>>();
    for (const importStmt of moduleFile.imports) {
      const alias =
        importStmt.alias || this.extractModuleName(importStmt.modulePath);
      scope.imports.set(alias, importStmt.modulePath);
      if (importStmt.selective) {
        scopeSelectiveImports.set(alias, new Set(importStmt.selective));
      }
    }
    if (scopeSelectiveImports.size > 0) {
      this.selectiveImports.set(moduleName, scopeSelectiveImports);
    } else {
      this.selectiveImports.delete(moduleName);
    }

    // Collect rules and exports from every grammar. Rule collection runs
    // FIRST across ALL grammars and export registration happens in a
    // second pass: an `@export` name is validated against the module's
    // complete rule set (a modular grammar may legitimately export a rule
    // declared by a sibling grammar in the same module file -- the module,
    // not the individual grammar, is the namespace), and a name no rule
    // declares is rejected as a phantom export (see ExportResolutionError).
    const rules = new Map<string, RuleDefinition>();
    const pendingExports: { grammarName: string; ruleName: string }[] = [];
    for (const grammar of moduleFile.grammars) {
      // Process rules
      for (const rule of grammar.rules) {
        scope.localRules.add(rule.name);
        rules.set(rule.name, rule);
      }

      // A grammar's exports: an explicit `@export: [...]` declaration lists
      // exactly the exported rules (including the `@export: []` "export
      // nothing" case -- `exports` is present but empty). With NO `@export`
      // at all the documented default applies -- "default: all rules are
      // exported" (docs/peg-grammar.md) -- so every rule of the grammar is
      // exported; previously `undefined` was wrongly treated as "export
      // nothing" instead (issue #56). Plain (non-modular) grammars have no
      // way to declare exports, so the same default covers them.
      const exports =
        grammar.type === "ModularGrammarDefinition"
          ? (grammar as ModularGrammarDefinition).exports
          : undefined;
      if (exports) {
        for (const ruleName of exports.rules) {
          pendingExports.push({ grammarName: grammar.name, ruleName });
        }
      } else {
        for (const rule of grammar.rules) {
          scope.exports.add(rule.name);
        }
      }
    }

    for (const { grammarName, ruleName } of pendingExports) {
      if (!rules.has(ruleName)) {
        throw new ExportResolutionError(ruleName, moduleName, grammarName);
      }
      scope.exports.add(ruleName);
    }

    this.scopes.set(moduleName, scope);
    this.moduleRules.set(moduleName, rules);
  }

  /**
   * Resolves a qualified name.
   */
  resolveQualifiedName(
    qualifiedId: QualifiedIdentifier,
    currentModule: string,
  ): ResolvedRule {
    const scope = this.scopes.get(currentModule);
    if (!scope) {
      throw new QualifiedNameResolutionError(
        `${qualifiedId.module}.${qualifiedId.name}`,
        `Module '${currentModule}' is not registered`,
      );
    }

    // Resolve the module alias to its actual module name
    const targetModulePath = scope.imports.get(qualifiedId.module);
    if (!targetModulePath) {
      throw new QualifiedNameResolutionError(
        `${qualifiedId.module}.${qualifiedId.name}`,
        `Module '${qualifiedId.module}' is not imported`,
      );
    }

    // A selective import (`import "m.tpeg" { r1, r2 }`) exposes ONLY the
    // listed rules -- without this check the basename-derived alias made
    // `alias.<any exported rule>` resolvable and the list restricted
    // nothing (#110).
    const selective = this.selectiveImports
      .get(currentModule)
      ?.get(qualifiedId.module);
    if (selective !== undefined && !selective.has(qualifiedId.name)) {
      throw new QualifiedNameResolutionError(
        `${qualifiedId.module}.${qualifiedId.name}`,
        `Rule '${qualifiedId.name}' is not in the selective import list of '${qualifiedId.module}'`,
      );
    }

    // Resolve the module name it was actually REGISTERED under -- not
    // necessarily `extractModuleName(targetModulePath)` alone, since a
    // module with an explicit `@namespace` differing from its own
    // basename is registered under that namespace instead (see
    // `resolveRegisteredModuleName`'s doc comment). The current module's
    // own filePath is supplied so a relative `modulePath` resolves
    // against the directory of the file that declared the import.
    const targetModule = this.resolveRegisteredModuleName(
      targetModulePath,
      this.moduleFilePaths.get(currentModule),
    );
    if (!targetModule) {
      throw new QualifiedNameResolutionError(
        `${qualifiedId.module}.${qualifiedId.name}`,
        `Module '${this.extractModuleName(targetModulePath)}' is not registered`,
      );
    }

    // Get the rule from the target module
    const targetRules = this.moduleRules.get(targetModule);
    if (!targetRules) {
      throw new QualifiedNameResolutionError(
        `${qualifiedId.module}.${qualifiedId.name}`,
        `Module '${targetModule}' is not registered`,
      );
    }

    const rule = targetRules.get(qualifiedId.name);
    if (!rule) {
      throw new QualifiedNameResolutionError(
        `${qualifiedId.module}.${qualifiedId.name}`,
        `Rule '${qualifiedId.name}' not found in module '${targetModule}'`,
      );
    }

    // Check whether it's exported
    const targetScope = this.scopes.get(targetModule);
    const isExported = targetScope?.exports.has(qualifiedId.name) ?? false;

    if (!isExported) {
      throw new QualifiedNameResolutionError(
        `${qualifiedId.module}.${qualifiedId.name}`,
        `Rule '${qualifiedId.name}' is not exported from module '${targetModule}'`,
      );
    }

    return {
      rule,
      moduleName: targetModule,
      isExported: true,
      isLocal: false,
    };
  }

  /**
   * Resolves a local rule.
   *
   * Looks at the module's own rules first; on a miss, a name listed by a
   * selective import (`import "m.tpeg" { r1, r2 }`, the documented
   * unqualified-import form in `docs/peg-grammar.md`) resolves against
   * the imported module's exports (#110). Two imports listing the same
   * name is a genuine ambiguity and throws `NamespaceConflictError`.
   */
  resolveLocalRule(ruleName: string, currentModule: string): ResolvedRule {
    const scope = this.scopes.get(currentModule);
    if (!scope) {
      throw new QualifiedNameResolutionError(
        ruleName,
        `Module '${currentModule}' is not registered`,
      );
    }

    const rules = this.moduleRules.get(currentModule);
    if (!rules) {
      throw new QualifiedNameResolutionError(
        ruleName,
        `Module '${currentModule}' is not registered`,
      );
    }

    const rule = rules.get(ruleName);
    if (rule) {
      return {
        rule,
        moduleName: currentModule,
        isExported: scope.exports.has(ruleName),
        isLocal: true,
      };
    }

    const selective = this.selectiveImports.get(currentModule);
    if (selective) {
      const providers: { moduleName: string; rule: RuleDefinition }[] = [];
      let listedButNotExported: string | undefined;
      for (const [alias, names] of selective) {
        if (!names.has(ruleName)) continue;
        const modulePath = scope.imports.get(alias);
        if (modulePath === undefined) continue;
        const targetModule = this.resolveRegisteredModuleName(
          modulePath,
          this.moduleFilePaths.get(currentModule),
        );
        if (!targetModule) continue;
        const targetRule = this.moduleRules.get(targetModule)?.get(ruleName);
        const isExported =
          this.scopes.get(targetModule)?.exports.has(ruleName) ?? false;
        if (!targetRule || !isExported) {
          listedButNotExported = targetModule;
          continue;
        }
        // The SAME rule reached through two aliases of ONE module
        // (`import "utils.tpeg" as u1 { foo }; import "utils.tpeg" as
        // u2 { foo };`) is a single provider, not an ambiguity -- a
        // module's `moduleRules` maps each name to one `RuleDefinition`,
        // so same `moduleName` means the identical rule object.
        // `checkNamespaceConflicts` groups by resolved target module
        // for the same reason; counting raw alias entries here made
        // that setup throw `NamespaceConflictError` while conflict
        // checking correctly reported none.
        if (!providers.some((p) => p.moduleName === targetModule)) {
          providers.push({ moduleName: targetModule, rule: targetRule });
        }
      }

      if (providers.length === 1) {
        const provider = providers[0];
        if (provider) {
          return {
            rule: provider.rule,
            moduleName: provider.moduleName,
            isExported: true,
            isLocal: false,
          };
        }
      }
      if (providers.length > 1) {
        throw new NamespaceConflictError(
          ruleName,
          providers.map((p) => p.moduleName),
          currentModule,
        );
      }
      if (listedButNotExported !== undefined) {
        throw new QualifiedNameResolutionError(
          ruleName,
          `Rule '${ruleName}' is selectively imported but not exported from module '${listedButNotExported}'`,
        );
      }
    }

    throw new QualifiedNameResolutionError(
      ruleName,
      `Rule '${ruleName}' not found in module '${currentModule}'`,
    );
  }

  /**
   * Checks for namespace conflicts.
   */
  checkNamespaceConflicts(currentModule: string): void {
    const scope = this.scopes.get(currentModule);
    if (!scope) {
      return;
    }

    // Check for rule-name collisions across imported modules. Grouped by
    // the imports' RESOLVED target module, not by alias: importing the
    // same module twice under two different aliases (`import "utils.tpeg"
    // as u1; import "utils.tpeg" as u2;`) must not be flagged as a
    // conflict -- `u1.foo` and `u2.foo` both resolve to the exact same
    // rule, unambiguously, regardless of how many local names point at
    // it. A `Set`, not an array, so a rule name reached via more than one
    // alias of the SAME module collapses to one entry instead of
    // (incorrectly) looking like multiple modules.
    const ruleToModules = new Map<string, Set<string>>();
    const selective = this.selectiveImports.get(currentModule);

    for (const [alias, modulePath] of scope.imports) {
      const targetModuleName = this.resolveRegisteredModuleName(
        modulePath,
        this.moduleFilePaths.get(currentModule),
      );
      if (!targetModuleName) continue;
      const targetScope = this.scopes.get(targetModuleName);
      if (!targetScope) continue;

      // A selective import only brings its LISTED names into scope --
      // counting every export here would report phantom conflicts for
      // rules the importer never referenced (#110).
      const listed = selective?.get(alias);

      for (const ruleName of targetScope.exports) {
        if (listed !== undefined && !listed.has(ruleName)) continue;
        if (!ruleToModules.has(ruleName)) {
          ruleToModules.set(ruleName, new Set());
        }
        ruleToModules.get(ruleName)?.add(targetModuleName);
      }
    }

    // Check for collisions
    for (const [ruleName, modules] of ruleToModules) {
      if (modules.size > 1) {
        throw new NamespaceConflictError(ruleName, [...modules], currentModule);
      }
    }
  }

  /**
   * Gets the rules available to a module.
   */
  getAvailableRules(currentModule: string): Map<string, Set<string>> {
    const scope = this.scopes.get(currentModule);
    if (!scope) {
      return new Map();
    }

    const available = new Map<string, Set<string>>();

    // Local rules
    available.set(currentModule, new Set(scope.localRules));

    // Exported rules of imported modules -- restricted to the listed
    // names for a selective import, matching resolveQualifiedName's
    // enforcement (#110).
    const selective = this.selectiveImports.get(currentModule);
    for (const [alias, modulePath] of scope.imports) {
      const targetModuleName = this.resolveRegisteredModuleName(
        modulePath,
        this.moduleFilePaths.get(currentModule),
      );
      const targetScope = targetModuleName
        ? this.scopes.get(targetModuleName)
        : undefined;
      if (targetScope) {
        const listed = selective?.get(alias);
        available.set(
          alias,
          listed === undefined
            ? new Set(targetScope.exports)
            : new Set(
                [...targetScope.exports].filter((name) => listed.has(name)),
              ),
        );
      }
    }

    return available;
  }

  /**
   * Extracts the module name from a path.
   *
   * This is deliberately basename-only (`libA/utils.tpeg` and
   * `libB/utils.tpeg` both extract to `"utils"`) -- the rest of this
   * class's public API (`resolveQualifiedName`/`resolveLocalRule` etc.)
   * takes `currentModule` as a short, caller-supplied string, matching an
   * import alias or an explicit `@namespace`, not a full resolved path;
   * switching this to a full-path-derived key would make every caller
   * (including real `ModuleResolver`-fed modules, whose `filePath` is an
   * absolute path) unable to look modules back up by the short name they
   * already use everywhere else in this API. See `registerModule`'s
   * collision guard for how the resulting ambiguity is instead made loud
   * (a thrown error) rather than a silent state-corrupting overwrite.
   */
  private extractModuleName(modulePath: string): string {
    return moduleNameFromPath(modulePath);
  }

  /**
   * Resolves an import's `modulePath` to the module name it was actually
   * REGISTERED under. `registerModule` registers a module under its
   * explicit `@namespace` when given one, and only falls back to
   * `extractModuleName(filePath)` (the basename) otherwise -- so an
   * importer referring to that module by its (basename-derived) path
   * can't just call `extractModuleName(modulePath)` and look it up
   * directly whenever the target was registered under a DIFFERENT,
   * explicit namespace.
   *
   * Matching is path-first: the import's `modulePath` is normalized
   * relative to the importing module's own directory (imports are
   * file paths, so `./b/u.tpeg` inside `/proj/c.tpeg` means
   * `/proj/b/u.tpeg`) and compared against each registered `filePath`.
   * Only when no registered `filePath` matches does this fall back to
   * comparing basenames -- the earlier behavior, which mis-resolved an
   * import to whichever same-basename module happened to be scanned
   * first (e.g. `/proj/a/u.tpeg` for an import of `./b/u.tpeg`). The
   * basename fallback still serves registrations whose `filePath` is a
   * bare name rather than a real path (as in unit tests), but if it
   * yields more than one candidate module the reference is genuinely
   * ambiguous and this throws rather than picking one arbitrarily.
   *
   * Returns `undefined` when no registered module matches, exactly like
   * `extractModuleName(modulePath)` failing to find an entry in
   * `moduleRules`/`scopes` used to (callers already handle that as
   * "not registered").
   */
  private resolveRegisteredModuleName(
    modulePath: string,
    importerFilePath?: string,
  ): string | undefined {
    const importerDir =
      importerFilePath === undefined
        ? ""
        : dirnameOf(normalizeModulePath(importerFilePath));
    const resolvedPath = normalizeModulePath(
      modulePath.startsWith("/") || importerDir === ""
        ? modulePath
        : `${importerDir}/${modulePath}`,
    );

    const pathMatches = new Set<string>();
    for (const [moduleName, filePath] of this.moduleFilePaths) {
      if (normalizeModulePath(filePath) === resolvedPath) {
        pathMatches.add(moduleName);
      }
    }
    if (pathMatches.size === 1) {
      return [...pathMatches][0];
    }
    if (pathMatches.size > 1) {
      throw new QualifiedNameResolutionError(
        modulePath,
        `Module path '${modulePath}' is ambiguous: it resolves to '${resolvedPath}', which is the filePath of multiple registered modules: ${[...pathMatches].join(", ")}`,
      );
    }

    const basename = this.extractModuleName(modulePath);
    const candidates = new Set<string>();
    if (this.moduleRules.has(basename)) {
      candidates.add(basename);
    }
    for (const [moduleName, filePath] of this.moduleFilePaths) {
      if (this.extractModuleName(filePath) === basename) {
        candidates.add(moduleName);
      }
    }
    if (candidates.size === 1) {
      return [...candidates][0];
    }
    if (candidates.size > 1) {
      throw new QualifiedNameResolutionError(
        modulePath,
        `Module path '${modulePath}' is ambiguous: basename '${basename}' matches multiple registered modules: ${[...candidates].join(", ")}`,
      );
    }
    return undefined;
  }

  /**
   * Gets a namespace scope.
   */
  getScope(moduleName: string): NamespaceScope | undefined {
    return this.scopes.get(moduleName);
  }

  /**
   * Gets the list of registered modules.
   */
  getRegisteredModules(): string[] {
    return Array.from(this.scopes.keys());
  }

  /**
   * Clears the namespace.
   */
  clear(): void {
    this.scopes.clear();
    this.moduleRules.clear();
    // `moduleFilePaths` (see its own doc comment above) must be cleared
    // too, or `registerModule`'s collision guard keeps comparing against
    // filePaths from a "cleared" namespace: a caller that clears and then
    // re-registers a DIFFERENT file under the same derived module name
    // (e.g. re-resolving a fresh module graph after this one was torn
    // down) would be wrongly rejected with a `ModuleNameCollisionError`
    // even though `getRegisteredModules()` reports nothing registered.
    this.moduleFilePaths.clear();
    this.selectiveImports.clear();
  }
}

import type {
  ModularGrammarDefinition,
  ModuleFile,
  QualifiedIdentifier,
} from "@suzumiyaaoba/tpeg-core";
import type { RuleDefinition } from "./types.js";

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

  /**
   * Registers a module.
   */
  registerModule(moduleFile: ModuleFile): void {
    const moduleName =
      moduleFile.moduleInfo?.namespace ||
      this.extractModuleName(moduleFile.filePath);

    const scope: NamespaceScope = {
      currentModule: moduleName,
      imports: new Map(),
      exports: new Set(),
      localRules: new Set(),
      availableRules: new Map(),
    };

    // Process imports
    for (const importStmt of moduleFile.imports) {
      const alias =
        importStmt.alias || this.extractModuleName(importStmt.modulePath);
      scope.imports.set(alias, importStmt.modulePath);
    }

    // Collect rules and exports from every grammar
    const rules = new Map<string, RuleDefinition>();
    for (const grammar of moduleFile.grammars) {
      // Process rules
      for (const rule of grammar.rules) {
        scope.localRules.add(rule.name);
        rules.set(rule.name, rule);
      }

      // For a modular grammar, process its exports
      if (grammar.type === "ModularGrammarDefinition") {
        const modularGrammar = grammar as ModularGrammarDefinition;
        if (modularGrammar.exports) {
          for (const ruleName of modularGrammar.exports.rules) {
            scope.exports.add(ruleName);
          }
        }
      }
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

    // Extract the module name from the path
    const targetModule = this.extractModuleName(targetModulePath);

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
    if (!rule) {
      throw new QualifiedNameResolutionError(
        ruleName,
        `Rule '${ruleName}' not found in module '${currentModule}'`,
      );
    }

    return {
      rule,
      moduleName: currentModule,
      isExported: scope.exports.has(ruleName),
      isLocal: true,
    };
  }

  /**
   * Checks for namespace conflicts.
   */
  checkNamespaceConflicts(currentModule: string): void {
    const scope = this.scopes.get(currentModule);
    if (!scope) {
      return;
    }

    // Check for rule-name collisions across imported modules
    const ruleToModules = new Map<string, string[]>();

    for (const [alias, modulePath] of scope.imports) {
      const targetModuleName = this.extractModuleName(modulePath);
      const targetScope = this.scopes.get(targetModuleName);
      if (!targetScope) continue;

      for (const ruleName of targetScope.exports) {
        if (!ruleToModules.has(ruleName)) {
          ruleToModules.set(ruleName, []);
        }
        ruleToModules.get(ruleName)?.push(alias);
      }
    }

    // Check for collisions
    for (const [ruleName, modules] of ruleToModules) {
      if (modules.length > 1) {
        throw new NamespaceConflictError(ruleName, modules, currentModule);
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

    // Exported rules of imported modules
    for (const [alias, modulePath] of scope.imports) {
      const targetModuleName = this.extractModuleName(modulePath);
      const targetScope = this.scopes.get(targetModuleName);
      if (targetScope) {
        available.set(alias, new Set(targetScope.exports));
      }
    }

    return available;
  }

  /**
   * Extracts the module name from a path.
   */
  private extractModuleName(modulePath: string): string {
    const parts = modulePath.split("/");
    const filename = parts[parts.length - 1];
    return filename ? filename.replace(/\.tpeg$/, "") : "unknown";
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
  }
}

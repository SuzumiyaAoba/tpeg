import type { GrammarDefinition, RuleDefinition } from "./types.js";

// Module system types (temporary until proper package structure)
interface ImportStatement {
  type: "ImportStatement";
  modulePath: string;
  alias?: string;
  selective?: string[];
  version?: string;
}

interface ExportDeclaration {
  type: "ExportDeclaration";
  rules: string[];
}

interface ModuleInfo {
  type: "ModuleInfo";
  namespace?: string;
  dependencies?: string[];
  conflicts?: string[];
  version?: string;
}

interface QualifiedIdentifier {
  type: "QualifiedIdentifier";
  module: string;
  name: string;
}

interface ModularGrammarDefinition extends Omit<GrammarDefinition, "type"> {
  type: "ModularGrammarDefinition";
  imports?: ImportStatement[];
  exports?: ExportDeclaration;
  moduleInfo?: ModuleInfo;
  extends?: string;
}

interface ModuleFile {
  type: "ModuleFile";
  filePath: string;
  imports: ImportStatement[];
  grammars: (GrammarDefinition | ModularGrammarDefinition)[];
  moduleInfo?: ModuleInfo;
}

/**
 * 名前空間の衝突エラー
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
 * 修飾名解決エラー
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
 * ルールの解決情報
 */
export interface ResolvedRule {
  rule: RuleDefinition;
  moduleName: string;
  isExported: boolean;
  isLocal: boolean;
}

/**
 * 名前空間のスコープ情報
 */
export interface NamespaceScope {
  /** 現在のモジュール名 */
  currentModule: string;
  /** インポートされたモジュールのエイリアス */
  imports: Map<string, string>; // alias -> module name
  /** エクスポートされたルール名 */
  exports: Set<string>;
  /** ローカルルール名 */
  localRules: Set<string>;
  /** 利用可能なルール (module -> rule names) */
  availableRules: Map<string, Set<string>>;
}

/**
 * 名前空間管理システム
 */
export class NamespaceManager {
  private scopes = new Map<string, NamespaceScope>();
  private moduleRules = new Map<string, Map<string, RuleDefinition>>();

  /**
   * モジュールを登録
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

    // インポートを処理
    for (const importStmt of moduleFile.imports) {
      const alias =
        importStmt.alias || this.extractModuleName(importStmt.modulePath);
      scope.imports.set(alias, importStmt.modulePath);
    }

    // 全てのグラマーからルールとエクスポートを収集
    const rules = new Map<string, RuleDefinition>();
    for (const grammar of moduleFile.grammars) {
      // ルールを処理
      for (const rule of grammar.rules) {
        scope.localRules.add(rule.name);
        rules.set(rule.name, rule);
      }

      // モジュラーグラマーの場合はエクスポートを処理
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
   * 修飾名を解決
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

    // モジュールエイリアスを実際のモジュール名に解決
    const targetModulePath = scope.imports.get(qualifiedId.module);
    if (!targetModulePath) {
      throw new QualifiedNameResolutionError(
        `${qualifiedId.module}.${qualifiedId.name}`,
        `Module '${qualifiedId.module}' is not imported`,
      );
    }

    // パスからモジュール名を取得
    const targetModule = this.extractModuleName(targetModulePath);

    // ターゲットモジュールからルールを取得
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

    // エクスポートされているかチェック
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
   * ローカルルールを解決
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
   * 名前空間の衝突をチェック
   */
  checkNamespaceConflicts(currentModule: string): void {
    const scope = this.scopes.get(currentModule);
    if (!scope) {
      return;
    }

    // インポートされたモジュール間でのルール名衝突をチェック
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

    // 衝突をチェック
    for (const [ruleName, modules] of ruleToModules) {
      if (modules.length > 1) {
        throw new NamespaceConflictError(ruleName, modules, currentModule);
      }
    }
  }

  /**
   * モジュールの利用可能なルールを取得
   */
  getAvailableRules(currentModule: string): Map<string, Set<string>> {
    const scope = this.scopes.get(currentModule);
    if (!scope) {
      return new Map();
    }

    const available = new Map<string, Set<string>>();

    // ローカルルール
    available.set(currentModule, new Set(scope.localRules));

    // インポートされたモジュールのエクスポートルール
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
   * モジュール名をパスから抽出
   */
  private extractModuleName(modulePath: string): string {
    const parts = modulePath.split("/");
    const filename = parts[parts.length - 1];
    return filename ? filename.replace(/\.tpeg$/, "") : "unknown";
  }

  /**
   * 名前空間スコープを取得
   */
  getScope(moduleName: string): NamespaceScope | undefined {
    return this.scopes.get(moduleName);
  }

  /**
   * 登録されているモジュール一覧を取得
   */
  getRegisteredModules(): string[] {
    return Array.from(this.scopes.keys());
  }

  /**
   * 名前空間をクリア
   */
  clear(): void {
    this.scopes.clear();
    this.moduleRules.clear();
  }
}

import type { GrammarDefinition } from "./types.js";

// Module system types (temporary until proper package structure)
interface ModuleInfo {
  type: "ModuleInfo";
  namespace?: string;
  dependencies?: string[];
  conflicts?: string[];
  version?: string;
}

interface ImportStatement {
  type: "ImportStatement";
  modulePath: string;
  alias?: string;
  selective?: string[];
  version?: string;
}

interface ModuleFile {
  type: "ModuleFile";
  filePath: string;
  imports: ImportStatement[];
  grammars: GrammarDefinition[];
  moduleInfo?: ModuleInfo;
}

/**
 * バージョン互換性エラー
 */
export class VersionCompatibilityError extends Error {
  constructor(
    public readonly moduleName: string,
    public readonly requiredVersion: string,
    public readonly actualVersion: string,
    public readonly reason: string,
  ) {
    super(
      `Version compatibility error for module '${moduleName}': required '${requiredVersion}', found '${actualVersion}' - ${reason}`,
    );
    this.name = "VersionCompatibilityError";
  }
}

/**
 * バージョン解析エラー
 */
export class VersionParseError extends Error {
  constructor(
    public readonly versionString: string,
    public readonly reason: string,
  ) {
    super(`Cannot parse version '${versionString}': ${reason}`);
    this.name = "VersionParseError";
  }
}

/**
 * セマンティックバージョン
 */
export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

/**
 * バージョン制約
 */
export interface VersionConstraint {
  operator: "=" | ">=" | "<=" | ">" | "<" | "^" | "~" | "*";
  version: SemanticVersion;
}

/**
 * モジュールバージョン情報
 */
export interface ModuleVersion {
  moduleName: string;
  version: SemanticVersion;
  dependencies: Map<string, VersionConstraint>;
  conflicts: Set<string>;
}

/**
 * バージョン管理システム
 */
export class VersionManager {
  private moduleVersions = new Map<string, ModuleVersion>();
  private versionCache = new Map<string, SemanticVersion>();

  /**
   * セマンティックバージョンを解析
   */
  parseVersion(versionString: string): SemanticVersion {
    if (this.versionCache.has(versionString)) {
      return this.versionCache.get(versionString)!;
    }

    const cleanVersion = versionString.replace(/^v/, "");
    const versionRegex =
      /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

    const match = cleanVersion.match(versionRegex);
    if (!match) {
      throw new VersionParseError(versionString, "Invalid semver format");
    }

    const version: SemanticVersion = {
      major: Number.parseInt(match[1] || "0", 10),
      minor: Number.parseInt(match[2] || "0", 10),
      patch: Number.parseInt(match[3] || "0", 10),
      ...(match[4] ? { prerelease: match[4] } : {}),
      ...(match[5] ? { build: match[5] } : {}),
    };

    this.versionCache.set(versionString, version);
    return version;
  }

  /**
   * バージョン制約を解析
   */
  parseVersionConstraint(constraintString: string): VersionConstraint {
    const trimmed = constraintString.trim();

    // 特殊ケース: * (any version)
    if (trimmed === "*") {
      return {
        operator: "*",
        version: { major: 0, minor: 0, patch: 0 },
      };
    }

    // 演算子を抽出
    const operatorMatch = trimmed.match(/^(>=|<=|>|<|\^|~|=)?(.+)$/);
    if (!operatorMatch) {
      throw new VersionParseError(
        constraintString,
        "Invalid constraint format",
      );
    }

    const operator = (operatorMatch[1] || "=") as VersionConstraint["operator"];
    const versionString = operatorMatch[2];

    if (!versionString) {
      throw new VersionParseError(constraintString, "Missing version string");
    }

    return {
      operator,
      version: this.parseVersion(versionString),
    };
  }

  /**
   * バージョンを比較
   */
  compareVersions(a: SemanticVersion, b: SemanticVersion): number {
    // メジャーバージョンを比較
    if (a.major !== b.major) {
      return a.major - b.major;
    }

    // マイナーバージョンを比較
    if (a.minor !== b.minor) {
      return a.minor - b.minor;
    }

    // パッチバージョンを比較
    if (a.patch !== b.patch) {
      return a.patch - b.patch;
    }

    // プレリリースバージョンを比較
    if (a.prerelease && b.prerelease) {
      return a.prerelease.localeCompare(b.prerelease);
    }

    if (a.prerelease && !b.prerelease) {
      return -1; // プレリリースは正式版より小さい
    }

    if (!a.prerelease && b.prerelease) {
      return 1; // 正式版はプレリリースより大きい
    }

    return 0; // 同じ
  }

  /**
   * バージョン制約を満たすかチェック
   */
  satisfiesConstraint(
    version: SemanticVersion,
    constraint: VersionConstraint,
  ): boolean {
    const comparison = this.compareVersions(version, constraint.version);

    switch (constraint.operator) {
      case "=":
        return comparison === 0;
      case ">":
        return comparison > 0;
      case ">=":
        return comparison >= 0;
      case "<":
        return comparison < 0;
      case "<=":
        return comparison <= 0;
      case "^":
        // Compatible within major version
        return version.major === constraint.version.major && comparison >= 0;
      case "~":
        // Compatible within minor version
        return (
          version.major === constraint.version.major &&
          version.minor === constraint.version.minor &&
          comparison >= 0
        );
      case "*":
        return true; // Any version
      default:
        return false;
    }
  }

  /**
   * モジュールバージョンを登録
   */
  registerModule(moduleFile: ModuleFile): void {
    const moduleName =
      moduleFile.moduleInfo?.namespace ||
      this.extractModuleName(moduleFile.filePath);
    const versionString = moduleFile.moduleInfo?.version || "1.0.0";
    const version = this.parseVersion(versionString);

    const dependencies = new Map<string, VersionConstraint>();
    const conflicts = new Set<string>();

    // インポートから依存関係を抽出
    for (const importStmt of moduleFile.imports) {
      if (importStmt.version) {
        const constraint = this.parseVersionConstraint(importStmt.version);
        dependencies.set(importStmt.modulePath, constraint);
      }
    }

    // モジュール情報から競合を抽出
    if (moduleFile.moduleInfo?.conflicts) {
      for (const conflict of moduleFile.moduleInfo.conflicts) {
        conflicts.add(conflict);
      }
    }

    // モジュール情報から依存関係を抽出
    if (moduleFile.moduleInfo?.dependencies) {
      for (const dependency of moduleFile.moduleInfo.dependencies) {
        if (!dependencies.has(dependency)) {
          // デフォルトの制約を追加
          dependencies.set(dependency, {
            operator: ">=",
            version: { major: 1, minor: 0, patch: 0 },
          });
        }
      }
    }

    const moduleVersion: ModuleVersion = {
      moduleName,
      version,
      dependencies,
      conflicts,
    };

    this.moduleVersions.set(moduleName, moduleVersion);
  }

  /**
   * バージョン互換性をチェック
   */
  checkCompatibility(
    _requiredModule: string,
    requiredVersion: string,
    availableVersion: string,
  ): boolean {
    try {
      const constraint = this.parseVersionConstraint(requiredVersion);
      const version = this.parseVersion(availableVersion);
      return this.satisfiesConstraint(version, constraint);
    } catch (_error) {
      return false;
    }
  }

  /**
   * モジュール間の依存関係を検証
   */
  validateDependencies(currentModule: string): void {
    const moduleVersion = this.moduleVersions.get(currentModule);
    if (!moduleVersion) {
      throw new VersionCompatibilityError(
        currentModule,
        "unknown",
        "unknown",
        "Module not registered",
      );
    }

    for (const [dependencyModule, constraint] of moduleVersion.dependencies) {
      const dependencyModuleName = this.extractModuleName(dependencyModule);
      const dependencyVersion = this.moduleVersions.get(dependencyModuleName);
      if (!dependencyVersion) {
        throw new VersionCompatibilityError(
          dependencyModule,
          this.formatConstraint(constraint),
          "not found",
          "Required dependency not found",
        );
      }

      if (!this.satisfiesConstraint(dependencyVersion.version, constraint)) {
        throw new VersionCompatibilityError(
          dependencyModule,
          this.formatConstraint(constraint),
          this.formatVersion(dependencyVersion.version),
          "Version constraint not satisfied",
        );
      }
    }

    // 競合をチェック
    for (const conflictModule of moduleVersion.conflicts) {
      if (this.moduleVersions.has(conflictModule)) {
        throw new VersionCompatibilityError(
          conflictModule,
          "none",
          this.formatVersion(this.moduleVersions.get(conflictModule)?.version),
          "Conflicting module detected",
        );
      }
    }
  }

  /**
   * 全てのモジュールの依存関係を検証
   */
  validateAllDependencies(): void {
    for (const moduleName of this.moduleVersions.keys()) {
      this.validateDependencies(moduleName);
    }
  }

  /**
   * バージョン制約を文字列にフォーマット
   */
  formatConstraint(constraint: VersionConstraint): string {
    if (constraint.operator === "*") {
      return "*";
    }
    return `${constraint.operator}${this.formatVersion(constraint.version)}`;
  }

  /**
   * バージョンを文字列にフォーマット
   */
  formatVersion(version: SemanticVersion): string {
    let formatted = `${version.major}.${version.minor}.${version.patch}`;
    if (version.prerelease) {
      formatted += `-${version.prerelease}`;
    }
    if (version.build) {
      formatted += `+${version.build}`;
    }
    return formatted;
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
   * モジュールバージョン情報を取得
   */
  getModuleVersion(moduleName: string): ModuleVersion | undefined {
    return this.moduleVersions.get(moduleName);
  }

  /**
   * 登録されているモジュール一覧を取得
   */
  getRegisteredModules(): string[] {
    return Array.from(this.moduleVersions.keys());
  }

  /**
   * 依存関係グラフを取得
   */
  getDependencyGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const [moduleName, moduleVersion] of this.moduleVersions) {
      const dependencies = Array.from(moduleVersion.dependencies.keys());
      graph.set(moduleName, dependencies);
    }

    return graph;
  }

  /**
   * 互換性マトリックスを取得
   */
  getCompatibilityMatrix(): Map<string, Map<string, boolean>> {
    const matrix = new Map<string, Map<string, boolean>>();

    for (const [moduleName, moduleVersion] of this.moduleVersions) {
      const compatibilityRow = new Map<string, boolean>();

      for (const [otherModuleName, otherModuleVersion] of this.moduleVersions) {
        if (moduleName === otherModuleName) {
          compatibilityRow.set(otherModuleName, true);
          continue;
        }

        // 競合チェック
        if (moduleVersion.conflicts.has(otherModuleName)) {
          compatibilityRow.set(otherModuleName, false);
          continue;
        }

        // 依存関係チェック
        const constraint = moduleVersion.dependencies.get(otherModuleName);
        if (constraint) {
          const isCompatible = this.satisfiesConstraint(
            otherModuleVersion.version,
            constraint,
          );
          compatibilityRow.set(otherModuleName, isCompatible);
        } else {
          compatibilityRow.set(otherModuleName, true); // 依存関係なし
        }
      }

      matrix.set(moduleName, compatibilityRow);
    }

    return matrix;
  }

  /**
   * バージョン管理データをクリア
   */
  clear(): void {
    this.moduleVersions.clear();
    this.versionCache.clear();
  }
}

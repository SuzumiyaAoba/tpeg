import type { ModuleFile } from "@suzumiyaaoba/tpeg-core";

const VERSION_PREFIX_RE = /^v/;
const SEMVER_RE =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CONSTRAINT_OPERATOR_RE = /^(>=|<=|>|<|\^|~|=)?(.+)$/;
const NUMERIC_IDENTIFIER_RE = /^\d+$/;

/**
 * Compares two dot-separated prerelease identifier strings (e.g.
 * `"alpha.2"` vs `"alpha.10"`) per semver's precedence rules: identifiers
 * are compared pairwise left to right, a purely-numeric identifier is
 * compared numerically (not lexically -- `"2"` < `"10"`, unlike
 * `String.prototype.localeCompare`, under which `"2" > "10"` since it
 * compares character by character), a numeric identifier always has
 * lower precedence than an alphanumeric one, and a shorter identifier
 * list with the rest matching has lower precedence than a longer one.
 * `SEMVER_RE` only ever lets `[0-9A-Za-z-]+` reach here, so every
 * identifier is either all-digits or genuinely alphanumeric -- no other
 * shape to handle.
 */
const comparePrereleaseIdentifiers = (a: string, b: string): number => {
  const aParts = a.split(".");
  const bParts = b.split(".");
  const len = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;

    const aIsNumeric = NUMERIC_IDENTIFIER_RE.test(aPart);
    const bIsNumeric = NUMERIC_IDENTIFIER_RE.test(bPart);
    if (aIsNumeric && bIsNumeric) {
      const diff = Number(aPart) - Number(bPart);
      if (diff !== 0) return diff;
      continue;
    }
    if (aIsNumeric !== bIsNumeric) return aIsNumeric ? -1 : 1;

    const cmp = aPart.localeCompare(bPart);
    if (cmp !== 0) return cmp;
  }

  return 0;
};

/**
 * Version compatibility error.
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
 * Version parse error.
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
 * Semantic version.
 */
export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

/**
 * Version constraint.
 */
export interface VersionConstraint {
  operator: "=" | ">=" | "<=" | ">" | "<" | "^" | "~" | "*";
  version: SemanticVersion;
}

/**
 * Module version information.
 */
export interface ModuleVersion {
  moduleName: string;
  version: SemanticVersion;
  dependencies: Map<string, VersionConstraint>;
  conflicts: Set<string>;
}

/**
 * Version management system.
 */
export class VersionManager {
  private moduleVersions = new Map<string, ModuleVersion>();
  private versionCache = new Map<string, SemanticVersion>();

  /**
   * Parses a semantic version.
   */
  parseVersion(versionString: string): SemanticVersion {
    const cached = this.versionCache.get(versionString);
    if (cached) {
      return cached;
    }

    const cleanVersion = versionString.replace(VERSION_PREFIX_RE, "");
    const match = cleanVersion.match(SEMVER_RE);
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
   * Parses a version constraint.
   */
  parseVersionConstraint(constraintString: string): VersionConstraint {
    const trimmed = constraintString.trim();

    // Special case: * (any version)
    if (trimmed === "*") {
      return {
        operator: "*",
        version: { major: 0, minor: 0, patch: 0 },
      };
    }

    // Extract the operator
    const operatorMatch = trimmed.match(CONSTRAINT_OPERATOR_RE);
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
   * Compares two versions.
   */
  compareVersions(a: SemanticVersion, b: SemanticVersion): number {
    // Compare major versions
    if (a.major !== b.major) {
      return a.major - b.major;
    }

    // Compare minor versions
    if (a.minor !== b.minor) {
      return a.minor - b.minor;
    }

    // Compare patch versions
    if (a.patch !== b.patch) {
      return a.patch - b.patch;
    }

    // Compare prerelease versions
    if (a.prerelease && b.prerelease) {
      return comparePrereleaseIdentifiers(a.prerelease, b.prerelease);
    }

    if (a.prerelease && !b.prerelease) {
      return -1; // A prerelease sorts before its release
    }

    if (!a.prerelease && b.prerelease) {
      return 1; // A release sorts after any of its prereleases
    }

    return 0; // Equal
  }

  /**
   * Checks whether a version satisfies a constraint.
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
   * Registers a module's version.
   */
  registerModule(moduleFile: ModuleFile): void {
    const moduleName =
      moduleFile.moduleInfo?.namespace ||
      this.extractModuleName(moduleFile.filePath);
    const versionString = moduleFile.moduleInfo?.version || "1.0.0";
    const version = this.parseVersion(versionString);

    const dependencies = new Map<string, VersionConstraint>();
    const conflicts = new Set<string>();

    // Extract dependencies from imports
    for (const importStmt of moduleFile.imports) {
      if (importStmt.version) {
        const constraint = this.parseVersionConstraint(importStmt.version);
        dependencies.set(importStmt.modulePath, constraint);
      }
    }

    // Extract conflicts from module info
    if (moduleFile.moduleInfo?.conflicts) {
      for (const conflict of moduleFile.moduleInfo.conflicts) {
        conflicts.add(conflict);
      }
    }

    // Extract dependencies from module info
    if (moduleFile.moduleInfo?.dependencies) {
      for (const dependency of moduleFile.moduleInfo.dependencies) {
        if (!dependencies.has(dependency)) {
          // Add a default constraint
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
   * Checks version compatibility.
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
   * Validates dependencies between modules.
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

    // Check for conflicts
    for (const conflictModule of moduleVersion.conflicts) {
      if (this.moduleVersions.has(conflictModule)) {
        const conflictingModule = this.moduleVersions.get(conflictModule);
        if (conflictingModule) {
          throw new VersionCompatibilityError(
            conflictModule,
            "none",
            this.formatVersion(conflictingModule.version),
            "Conflicting module detected",
          );
        }
      }
    }
  }

  /**
   * Validates dependencies for every module.
   */
  validateAllDependencies(): void {
    for (const moduleName of this.moduleVersions.keys()) {
      this.validateDependencies(moduleName);
    }
  }

  /**
   * Formats a version constraint as a string.
   */
  formatConstraint(constraint: VersionConstraint): string {
    if (constraint.operator === "*") {
      return "*";
    }
    return `${constraint.operator}${this.formatVersion(constraint.version)}`;
  }

  /**
   * Formats a version as a string.
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
   * Extracts the module name from a path.
   */
  private extractModuleName(modulePath: string): string {
    const parts = modulePath.split("/");
    const filename = parts[parts.length - 1];
    return filename ? filename.replace(/\.tpeg$/, "") : "unknown";
  }

  /**
   * Gets a module's version information.
   */
  getModuleVersion(moduleName: string): ModuleVersion | undefined {
    return this.moduleVersions.get(moduleName);
  }

  /**
   * Gets the list of registered modules.
   */
  getRegisteredModules(): string[] {
    return Array.from(this.moduleVersions.keys());
  }

  /**
   * Gets the dependency graph.
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
   * Gets the compatibility matrix.
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

        // Conflict check
        if (moduleVersion.conflicts.has(otherModuleName)) {
          compatibilityRow.set(otherModuleName, false);
          continue;
        }

        // Dependency check
        const constraint = moduleVersion.dependencies.get(otherModuleName);
        if (constraint) {
          const isCompatible = this.satisfiesConstraint(
            otherModuleVersion.version,
            constraint,
          );
          compatibilityRow.set(otherModuleName, isCompatible);
        } else {
          compatibilityRow.set(otherModuleName, true); // No dependency
        }
      }

      matrix.set(moduleName, compatibilityRow);
    }

    return matrix;
  }

  /**
   * Clears version management data.
   */
  clear(): void {
    this.moduleVersions.clear();
    this.versionCache.clear();
  }
}

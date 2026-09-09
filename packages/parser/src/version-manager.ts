import type { ModuleFile } from "@suzumiyaaoba/tpeg-core";

const VERSION_PREFIX_RE = /^v/;
const SEMVER_RE =
  /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
// `\s*` between the operator and the version tolerates a constraint written
// with a space after the operator (e.g. ">= 1.0.0") -- a common, valid way
// to write a version range that this regex used to reject outright (the
// leftover leading space made the version half fail `SEMVER_RE`).
const CONSTRAINT_OPERATOR_RE = /^(>=|<=|>|<|\^|~|=)?\s*(.+)$/;
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
  const aIdentifiers = a.split(".");
  const bIdentifiers = b.split(".");
  const len = Math.max(aIdentifiers.length, bIdentifiers.length);

  for (let i = 0; i < len; i++) {
    const aIdentifier = aIdentifiers[i];
    const bIdentifier = bIdentifiers[i];
    if (aIdentifier === undefined) return -1;
    if (bIdentifier === undefined) return 1;
    if (aIdentifier === bIdentifier) continue;

    const aIsNumeric = NUMERIC_IDENTIFIER_RE.test(aIdentifier);
    const bIsNumeric = NUMERIC_IDENTIFIER_RE.test(bIdentifier);
    if (aIsNumeric && bIsNumeric) {
      if (aIdentifier.length !== bIdentifier.length) {
        return aIdentifier.length - bIdentifier.length;
      }
      return aIdentifier < bIdentifier ? -1 : 1;
    }
    if (aIsNumeric !== bIsNumeric) return aIsNumeric ? -1 : 1;

    if (aIdentifier < bIdentifier) return -1;
    if (aIdentifier > bIdentifier) return 1;
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
  additional?: VersionConstraint[];
  /**
   * How many components of the constraint's version string were explicitly
   * given: `"major"` for a bare `"1"`, `"minor"` for `"1.2"`, `"patch"` for
   * a fully-specified `"1.2.3"`. `parseVersion` defaults an omitted minor/
   * patch to `0`, which loses exactly the information `~`/`^` matching
   * needs: standard semver gives `~1` (major only) and `^0.0` (minor
   * explicit, major/minor both zero) wider matching ranges than the
   * fully-pinned `~1.0.0`/`^0.0.0` would -- see `satisfiesConstraint`'s
   * `~`/`^` cases below for exactly where this makes a difference. Not
   * meaningful for any other operator.
   */
  precision?: "major" | "minor" | "patch";
}

/**
 * Module version information.
 */
export interface ModuleVersion {
  moduleName: string;
  filePath: string;
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
    const parts = constraintString.split(",").map((part) => part.trim());
    if (parts.some((part) => part.length === 0)) {
      throw new VersionParseError(
        constraintString,
        "Invalid constraint format",
      );
    }

    const [firstPart, ...remainingParts] = parts;
    if (!firstPart) {
      throw new VersionParseError(
        constraintString,
        "Invalid constraint format",
      );
    }

    const constraint = this.parseSingleVersionConstraint(firstPart);
    if (remainingParts.length === 0) {
      return constraint;
    }

    return {
      ...constraint,
      additional: remainingParts.map((part) =>
        this.parseSingleVersionConstraint(part),
      ),
    };
  }

  private parseSingleVersionConstraint(
    constraintString: string,
  ): VersionConstraint {
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
      precision: this.versionPrecision(versionString),
    };
  }

  /**
   * How many components `versionString` (already isolated from its
   * operator/prefix by `parseSingleVersionConstraint`) explicitly
   * specifies -- see `VersionConstraint.precision`'s doc comment for why
   * this can't be recovered from `parseVersion`'s own return value once it
   * has defaulted an omitted minor/patch to `0`. Re-matches `SEMVER_RE`
   * directly rather than threading extra state through `parseVersion`
   * (called far more often, and from far more places, than this) --
   * cheap and only ever called once per constraint parse.
   */
  private versionPrecision(versionString: string): "major" | "minor" | "patch" {
    const cleanVersion = versionString.replace(VERSION_PREFIX_RE, "");
    const match = cleanVersion.match(SEMVER_RE);
    // Unreachable in practice: `parseVersion`, called immediately above
    // with the same string, already throws on a format `SEMVER_RE` rejects.
    if (!match) return "patch";
    if (match[3] !== undefined) return "patch";
    if (match[2] !== undefined) return "minor";
    return "major";
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
   *
   * A prerelease version needs an extra gate ON TOP OF the ordinary
   * per-comparator checks below: per npm semver, a prerelease version
   * satisfies a range only if at least one comparator in the WHOLE
   * comparator set (this constraint plus every comma-separated
   * `additional` one -- `parseVersionConstraint` ANDs them together, there
   * is no OR here) shares its exact `[major, minor, patch]` tuple AND
   * itself carries a prerelease tag. Without this, `"1.5.0-beta"` would
   * satisfy `"^1.0.0"` and `"2.0.0-beta"` would satisfy `">=1.0.0"` --
   * neither of which npm semver allows, since a prerelease is only ever
   * meant to be reachable by a constraint that was written expecting one.
   *
   * This MUST be evaluated once over the full comparator set, not inside
   * a single comparator's own check: a compound range like
   * `">=1.0.0-alpha, <2.0.0"` must still accept `"1.0.0-beta"` even though
   * the `"<2.0.0"` comparator alone doesn't share the `(1,0,0)` tuple --
   * gating each comparator independently would reject that compound range
   * outright, which is wrong (see this method's own tests).
   */
  satisfiesConstraint(
    version: SemanticVersion,
    constraint: VersionConstraint,
  ): boolean {
    // `additional` entries are always leaf comparators themselves (only
    // `parseVersionConstraint`'s first part ever sets `.additional`), so
    // this one level of flattening covers every comparator in the range.
    const comparators = [constraint, ...(constraint.additional ?? [])];

    if (
      version.prerelease !== undefined &&
      !comparators.some(
        (c) =>
          c.version.prerelease !== undefined &&
          c.version.major === version.major &&
          c.version.minor === version.minor &&
          c.version.patch === version.patch,
      )
    ) {
      return false;
    }

    return comparators.every((c) => this.satisfiesSingleConstraint(version, c));
  }

  /**
   * The ordinary per-comparator half of {@link satisfiesConstraint}: one
   * operator/version pair, with no awareness of `additional` or the
   * prerelease gate (both handled by the caller). Not exported --
   * `additional` and the prerelease gate are both necessary parts of
   * checking a full constraint, so a caller should never invoke this
   * directly on a single comparator.
   */
  private satisfiesSingleConstraint(
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
      case "^": {
        if (comparison < 0 || version.major !== constraint.version.major) {
          return false;
        }
        if (constraint.version.major > 0) {
          return true;
        }
        // major === 0 from here on: npm semver narrows the allowed range
        // as fewer components stay unpinned. `"^0"` (major-only) allows
        // any 0.x.y; `"^0.0"` (minor explicit, patch defaulted) allows any
        // 0.0.x; only a fully-specified `"^0.0.3"` pins the patch exactly.
        // `constraint.version.minor`/`.patch` alone can't tell these apart
        // from each other once `parseVersion` has defaulted an omitted
        // component to `0` -- that's what `precision` (set by
        // `parseSingleVersionConstraint`, absent on a hand-built
        // `VersionConstraint`) recovers.
        if (constraint.precision === "major") {
          return true;
        }
        if (constraint.version.minor > 0) {
          return version.minor === constraint.version.minor;
        }
        if (constraint.precision === "minor") {
          return version.minor === 0;
        }
        return (
          version.minor === 0 && version.patch === constraint.version.patch
        );
      }
      case "~":
        // Compatible within minor version -- EXCEPT a major-only
        // constraint (`"~1"`, `precision === "major"`), which npm semver
        // gives the *wider* `>=1.0.0 <2.0.0` range (same as `^1`), unlike
        // the minor-locked `"~1.0"`/`"~1.0.0"` handled by the fallback
        // below. `constraint.version.minor` alone can't distinguish "~1"
        // from "~1.0": `parseVersion` defaults both to `minor: 0`.
        if (constraint.precision === "major") {
          return version.major === constraint.version.major && comparison >= 0;
        }
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
      filePath: moduleFile.filePath,
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
      const dependencyVersion = this.findRegisteredModule(dependencyModule);
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
      const conflictingModule = this.findRegisteredModule(conflictModule);
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
    const primary =
      constraint.operator === "*"
        ? "*"
        : `${constraint.operator}${this.formatVersion(constraint.version)}`;
    return constraint.additional?.length
      ? [
          primary,
          ...constraint.additional.map((item) => this.formatConstraint(item)),
        ].join(", ")
      : primary;
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

  private referenceTargetsModule(
    reference: string,
    moduleName: string,
    moduleVersion: ModuleVersion,
  ): boolean {
    return (
      reference === moduleName ||
      reference === moduleVersion.filePath ||
      this.extractModuleName(reference) === moduleName ||
      this.extractModuleName(reference) ===
        this.extractModuleName(moduleVersion.filePath)
    );
  }

  private findRegisteredModule(reference: string): ModuleVersion | undefined {
    for (const [moduleName, moduleVersion] of this.moduleVersions) {
      if (this.referenceTargetsModule(reference, moduleName, moduleVersion)) {
        return moduleVersion;
      }
    }
    return undefined;
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

        // 競合チェック
        if (
          [...moduleVersion.conflicts].some((reference) =>
            this.referenceTargetsModule(
              reference,
              otherModuleName,
              otherModuleVersion,
            ),
          )
        ) {
          compatibilityRow.set(otherModuleName, false);
          continue;
        }

        // 依存関係チェック
        const constraint = [...moduleVersion.dependencies].find(([reference]) =>
          this.referenceTargetsModule(
            reference,
            otherModuleName,
            otherModuleVersion,
          ),
        )?.[1];
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

import { beforeEach, describe, expect, it } from "bun:test";
import type { GrammarDefinition } from "./types.js";
import {
  type ModuleVersion,
  type SemanticVersion,
  VersionCompatibilityError,
  type VersionConstraint,
  VersionManager,
  VersionParseError,
} from "./version-manager.js";

// テスト用の型定義
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

describe("VersionManager", () => {
  let manager: VersionManager;

  beforeEach(() => {
    manager = new VersionManager();
  });

  // テストデータ作成ヘルパー
  const createGrammar = (name: string): GrammarDefinition => ({
    type: "GrammarDefinition",
    name,
    annotations: [],
    rules: [],
  });

  const createModuleFile = (
    filePath: string,
    grammars: GrammarDefinition[] = [createGrammar("TestGrammar")],
    imports: ImportStatement[] = [],
    moduleInfo?: ModuleInfo,
  ): ModuleFile => ({
    type: "ModuleFile",
    filePath,
    imports,
    grammars,
    moduleInfo,
  });

  describe("parseVersion", () => {
    it("should parse valid semantic versions", () => {
      const version = manager.parseVersion("1.2.3");
      expect(version).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
      });
    });

    it("should parse version with prerelease", () => {
      const version = manager.parseVersion("1.2.3-alpha.1");
      expect(version).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: "alpha.1",
      });
    });

    it("should parse version with build metadata", () => {
      const version = manager.parseVersion("1.2.3+build.1");
      expect(version).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        build: "build.1",
      });
    });

    it("should parse version with both prerelease and build", () => {
      const version = manager.parseVersion("1.2.3-alpha.1+build.1");
      expect(version).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: "alpha.1",
        build: "build.1",
      });
    });

    it("should handle v prefix", () => {
      const version = manager.parseVersion("v1.2.3");
      expect(version).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
      });
    });

    it("should throw error for invalid version", () => {
      expect(() => {
        manager.parseVersion("invalid");
      }).toThrow(VersionParseError);
    });

    it("should cache parsed versions", () => {
      const version1 = manager.parseVersion("1.2.3");
      const version2 = manager.parseVersion("1.2.3");
      expect(version1).toBe(version2); // Same object reference
    });
  });

  describe("parseVersionConstraint", () => {
    it("should parse exact version constraint", () => {
      const constraint = manager.parseVersionConstraint("=1.2.3");
      expect(constraint.operator).toBe("=");
      expect(constraint.version).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
      });
    });

    it("should parse caret constraint", () => {
      const constraint = manager.parseVersionConstraint("^1.2.3");
      expect(constraint.operator).toBe("^");
      expect(constraint.version).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
      });
    });

    it("should parse tilde constraint", () => {
      const constraint = manager.parseVersionConstraint("~1.2.3");
      expect(constraint.operator).toBe("~");
      expect(constraint.version).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
      });
    });

    it("should parse range constraints", () => {
      const constraints = [
        manager.parseVersionConstraint(">=1.2.3"),
        manager.parseVersionConstraint("<=1.2.3"),
        manager.parseVersionConstraint(">1.2.3"),
        manager.parseVersionConstraint("<1.2.3"),
      ];

      expect(constraints.map((c) => c.operator)).toEqual([
        ">=",
        "<=",
        ">",
        "<",
      ]);
    });

    it("should parse wildcard constraint", () => {
      const constraint = manager.parseVersionConstraint("*");
      expect(constraint.operator).toBe("*");
    });

    it("should default to exact match without operator", () => {
      const constraint = manager.parseVersionConstraint("1.2.3");
      expect(constraint.operator).toBe("=");
    });
  });

  describe("compareVersions", () => {
    it("should compare major versions", () => {
      const v1: SemanticVersion = { major: 1, minor: 0, patch: 0 };
      const v2: SemanticVersion = { major: 2, minor: 0, patch: 0 };
      expect(manager.compareVersions(v1, v2)).toBeLessThan(0);
      expect(manager.compareVersions(v2, v1)).toBeGreaterThan(0);
    });

    it("should compare minor versions", () => {
      const v1: SemanticVersion = { major: 1, minor: 1, patch: 0 };
      const v2: SemanticVersion = { major: 1, minor: 2, patch: 0 };
      expect(manager.compareVersions(v1, v2)).toBeLessThan(0);
      expect(manager.compareVersions(v2, v1)).toBeGreaterThan(0);
    });

    it("should compare patch versions", () => {
      const v1: SemanticVersion = { major: 1, minor: 0, patch: 1 };
      const v2: SemanticVersion = { major: 1, minor: 0, patch: 2 };
      expect(manager.compareVersions(v1, v2)).toBeLessThan(0);
      expect(manager.compareVersions(v2, v1)).toBeGreaterThan(0);
    });

    it("should compare prerelease versions", () => {
      const v1: SemanticVersion = {
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: "alpha",
      };
      const v2: SemanticVersion = {
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: "beta",
      };
      const v3: SemanticVersion = { major: 1, minor: 0, patch: 0 };

      expect(manager.compareVersions(v1, v2)).toBeLessThan(0);
      expect(manager.compareVersions(v1, v3)).toBeLessThan(0); // prerelease < release
      expect(manager.compareVersions(v3, v1)).toBeGreaterThan(0); // release > prerelease
    });

    it("should return 0 for equal versions", () => {
      const v1: SemanticVersion = { major: 1, minor: 2, patch: 3 };
      const v2: SemanticVersion = { major: 1, minor: 2, patch: 3 };
      expect(manager.compareVersions(v1, v2)).toBe(0);
    });
  });

  describe("satisfiesConstraint", () => {
    const version: SemanticVersion = { major: 1, minor: 2, patch: 3 };

    it("should handle exact match constraint", () => {
      const constraint: VersionConstraint = { operator: "=", version };
      expect(manager.satisfiesConstraint(version, constraint)).toBe(true);

      const otherVersion: SemanticVersion = { major: 1, minor: 2, patch: 4 };
      expect(manager.satisfiesConstraint(otherVersion, constraint)).toBe(false);
    });

    it("should handle caret constraint", () => {
      const constraint: VersionConstraint = { operator: "^", version };

      // Compatible versions
      expect(
        manager.satisfiesConstraint(
          { major: 1, minor: 2, patch: 3 },
          constraint,
        ),
      ).toBe(true);
      expect(
        manager.satisfiesConstraint(
          { major: 1, minor: 2, patch: 4 },
          constraint,
        ),
      ).toBe(true);
      expect(
        manager.satisfiesConstraint(
          { major: 1, minor: 3, patch: 0 },
          constraint,
        ),
      ).toBe(true);

      // Incompatible versions
      expect(
        manager.satisfiesConstraint(
          { major: 2, minor: 0, patch: 0 },
          constraint,
        ),
      ).toBe(false);
      expect(
        manager.satisfiesConstraint(
          { major: 1, minor: 2, patch: 2 },
          constraint,
        ),
      ).toBe(false);
    });

    it("should handle tilde constraint", () => {
      const constraint: VersionConstraint = { operator: "~", version };

      // Compatible versions
      expect(
        manager.satisfiesConstraint(
          { major: 1, minor: 2, patch: 3 },
          constraint,
        ),
      ).toBe(true);
      expect(
        manager.satisfiesConstraint(
          { major: 1, minor: 2, patch: 4 },
          constraint,
        ),
      ).toBe(true);

      // Incompatible versions
      expect(
        manager.satisfiesConstraint(
          { major: 1, minor: 3, patch: 0 },
          constraint,
        ),
      ).toBe(false);
      expect(
        manager.satisfiesConstraint(
          { major: 1, minor: 2, patch: 2 },
          constraint,
        ),
      ).toBe(false);
    });

    it("should handle range constraints", () => {
      const constraints = [
        { operator: ">=", version } as VersionConstraint,
        { operator: "<=", version } as VersionConstraint,
        { operator: ">", version } as VersionConstraint,
        { operator: "<", version } as VersionConstraint,
      ];

      const testVersion = { major: 1, minor: 2, patch: 4 };

      expect(manager.satisfiesConstraint(testVersion, constraints[0])).toBe(
        true,
      ); // >=
      expect(manager.satisfiesConstraint(testVersion, constraints[1])).toBe(
        false,
      ); // <=
      expect(manager.satisfiesConstraint(testVersion, constraints[2])).toBe(
        true,
      ); // >
      expect(manager.satisfiesConstraint(testVersion, constraints[3])).toBe(
        false,
      ); // <
    });

    it("should handle wildcard constraint", () => {
      const constraint: VersionConstraint = {
        operator: "*",
        version: { major: 0, minor: 0, patch: 0 },
      };
      expect(manager.satisfiesConstraint(version, constraint)).toBe(true);
      expect(
        manager.satisfiesConstraint(
          { major: 999, minor: 999, patch: 999 },
          constraint,
        ),
      ).toBe(true);
    });
  });

  describe("registerModule", () => {
    it("should register a module with default version", () => {
      const moduleFile = createModuleFile("test.tpeg");
      manager.registerModule(moduleFile);

      const moduleVersion = manager.getModuleVersion("test");
      expect(moduleVersion).toBeDefined();
      expect(moduleVersion?.version).toEqual({ major: 1, minor: 0, patch: 0 });
    });

    it("should register a module with specified version", () => {
      const moduleInfo: ModuleInfo = {
        type: "ModuleInfo",
        version: "2.1.0",
      };
      const moduleFile = createModuleFile(
        "test.tpeg",
        [createGrammar("TestGrammar")],
        [],
        moduleInfo,
      );
      manager.registerModule(moduleFile);

      const moduleVersion = manager.getModuleVersion("test");
      expect(moduleVersion?.version).toEqual({ major: 2, minor: 1, patch: 0 });
    });

    it("should register a module with dependencies", () => {
      const imports: ImportStatement[] = [
        { type: "ImportStatement", modulePath: "base.tpeg", version: "^1.0.0" },
        {
          type: "ImportStatement",
          modulePath: "utils.tpeg",
          version: "~2.0.0",
        },
      ];
      const moduleFile = createModuleFile(
        "test.tpeg",
        [createGrammar("TestGrammar")],
        imports,
      );
      manager.registerModule(moduleFile);

      const moduleVersion = manager.getModuleVersion("test");
      expect(moduleVersion?.dependencies.size).toBe(2);
      expect(moduleVersion?.dependencies.get("base.tpeg")?.operator).toBe("^");
      expect(moduleVersion?.dependencies.get("utils.tpeg")?.operator).toBe("~");
    });

    it("should register a module with conflicts", () => {
      const moduleInfo: ModuleInfo = {
        type: "ModuleInfo",
        conflicts: ["old-module", "deprecated-module"],
      };
      const moduleFile = createModuleFile(
        "test.tpeg",
        [createGrammar("TestGrammar")],
        [],
        moduleInfo,
      );
      manager.registerModule(moduleFile);

      const moduleVersion = manager.getModuleVersion("test");
      expect(moduleVersion?.conflicts.has("old-module")).toBe(true);
      expect(moduleVersion?.conflicts.has("deprecated-module")).toBe(true);
    });
  });

  describe("checkCompatibility", () => {
    it("should check version compatibility", () => {
      expect(manager.checkCompatibility("test", "^1.0.0", "1.2.3")).toBe(true);
      expect(manager.checkCompatibility("test", "^1.0.0", "2.0.0")).toBe(false);
      expect(manager.checkCompatibility("test", "~1.2.0", "1.2.5")).toBe(true);
      expect(manager.checkCompatibility("test", "~1.2.0", "1.3.0")).toBe(false);
    });

    it("should return false for invalid versions", () => {
      expect(manager.checkCompatibility("test", "invalid", "1.0.0")).toBe(
        false,
      );
      expect(manager.checkCompatibility("test", "^1.0.0", "invalid")).toBe(
        false,
      );
    });
  });

  describe("validateDependencies", () => {
    beforeEach(() => {
      // Setup test modules
      const baseModule = createModuleFile(
        "base.tpeg",
        [createGrammar("BaseGrammar")],
        [],
        {
          type: "ModuleInfo",
          version: "1.2.0",
        },
      );
      manager.registerModule(baseModule);

      const utilsModule = createModuleFile(
        "utils.tpeg",
        [createGrammar("UtilsGrammar")],
        [],
        {
          type: "ModuleInfo",
          version: "2.1.0",
        },
      );
      manager.registerModule(utilsModule);
    });

    it("should validate compatible dependencies", () => {
      const mainModule = createModuleFile(
        "main.tpeg",
        [createGrammar("MainGrammar")],
        [
          {
            type: "ImportStatement",
            modulePath: "base.tpeg",
            version: "^1.0.0",
          },
          {
            type: "ImportStatement",
            modulePath: "utils.tpeg",
            version: "~2.1.0",
          },
        ],
      );
      manager.registerModule(mainModule);

      expect(() => {
        manager.validateDependencies("main");
      }).not.toThrow();
    });

    it("should throw error for incompatible dependencies", () => {
      const mainModule = createModuleFile(
        "main.tpeg",
        [createGrammar("MainGrammar")],
        [
          {
            type: "ImportStatement",
            modulePath: "base.tpeg",
            version: "^2.0.0",
          }, // incompatible
        ],
      );
      manager.registerModule(mainModule);

      expect(() => {
        manager.validateDependencies("main");
      }).toThrow(VersionCompatibilityError);
    });

    it("should throw error for missing dependencies", () => {
      const mainModule = createModuleFile(
        "main.tpeg",
        [createGrammar("MainGrammar")],
        [
          {
            type: "ImportStatement",
            modulePath: "nonexistent.tpeg",
            version: "^1.0.0",
          },
        ],
      );
      manager.registerModule(mainModule);

      expect(() => {
        manager.validateDependencies("main");
      }).toThrow(VersionCompatibilityError);
    });

    it("should detect conflicting modules", () => {
      const conflictingModule = createModuleFile(
        "conflicting.tpeg",
        [createGrammar("ConflictingGrammar")],
        [],
        {
          type: "ModuleInfo",
          version: "1.0.0",
        },
      );
      manager.registerModule(conflictingModule);

      const mainModule = createModuleFile(
        "main.tpeg",
        [createGrammar("MainGrammar")],
        [],
        {
          type: "ModuleInfo",
          conflicts: ["conflicting"],
        },
      );
      manager.registerModule(mainModule);

      expect(() => {
        manager.validateDependencies("main");
      }).toThrow(VersionCompatibilityError);
    });
  });

  describe("utility methods", () => {
    beforeEach(() => {
      const module1 = createModuleFile(
        "module1.tpeg",
        [createGrammar("Module1")],
        [
          {
            type: "ImportStatement",
            modulePath: "module2.tpeg",
            version: "^1.0.0",
          },
        ],
      );
      const module2 = createModuleFile("module2.tpeg", [
        createGrammar("Module2"),
      ]);

      manager.registerModule(module1);
      manager.registerModule(module2);
    });

    it("should get registered modules", () => {
      const modules = manager.getRegisteredModules();
      expect(modules).toContain("module1");
      expect(modules).toContain("module2");
    });

    it("should get dependency graph", () => {
      const graph = manager.getDependencyGraph();
      expect(graph.get("module1")).toEqual(["module2.tpeg"]);
      expect(graph.get("module2")).toEqual([]);
    });

    it("should get compatibility matrix", () => {
      const matrix = manager.getCompatibilityMatrix();
      expect(matrix.get("module1")?.get("module1")).toBe(true); // self-compatible
      expect(matrix.get("module1")?.get("module2")).toBe(true); // compatible dependency
    });

    it("should format versions and constraints", () => {
      const version: SemanticVersion = {
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: "alpha",
      };
      const constraint: VersionConstraint = { operator: "^", version };

      expect(manager.formatVersion(version)).toBe("1.2.3-alpha");
      expect(manager.formatConstraint(constraint)).toBe("^1.2.3-alpha");
    });

    it("should clear all data", () => {
      manager.clear();
      expect(manager.getRegisteredModules()).toEqual([]);
    });
  });
});

import { beforeEach, describe, expect, it } from "bun:test";
import type { ImportStatement } from "tpeg-core";
import { type FileSystemInterface, ModuleResolver } from "./module-resolver.js";
import { NamespaceManager } from "./namespace-manager.js";
import { VersionManager } from "./version-manager.js";

// Mock file system for testing
class MockFileSystem implements FileSystemInterface {
  private files = new Map<string, string>();

  addFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (!content) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  resolvePath(basePath: string, relativePath: string): string {
    if (relativePath.startsWith("/")) {
      return relativePath;
    }
    return `${basePath}/${relativePath}`;
  }

  resolve(basePath: string, relativePath: string): string {
    return this.resolvePath(basePath, relativePath);
  }
}

describe("Module System Integration Tests", () => {
  let resolver: ModuleResolver;
  let namespaceManager: NamespaceManager;
  let versionManager: VersionManager;
  let mockFs: MockFileSystem;

  beforeEach(() => {
    mockFs = new MockFileSystem();
    resolver = new ModuleResolver("/test", mockFs);
    namespaceManager = new NamespaceManager();
    versionManager = new VersionManager();
  });

  describe("Basic Module System Functionality", () => {
    it("should resolve module dependencies correctly", async () => {
      // Setup test modules
      const BASE_MODULE = `
        grammar BaseGrammar {
          number = [0-9]+
        }
      `;

      const MAIN_MODULE = `
        import "base.tpeg" as base
        
        grammar MainGrammar {
          expression = base.number
        }
      `;

      mockFs.addFile("/test/base.tpeg", BASE_MODULE);
      mockFs.addFile("/test/main.tpeg", MAIN_MODULE);

      // Test module resolution
      const baseResolved = await resolver.resolveModule("/test/base.tpeg");
      const mainResolved = await resolver.resolveModule("/test/main.tpeg");

      expect(baseResolved.resolved).toBe(true);
      expect(mainResolved.resolved).toBe(true);
      expect(mainResolved.dependencies).toContain("/test/base.tpeg");
    });

    it("should handle version parsing correctly", () => {
      // Test version parsing
      const version1 = versionManager.parseVersion("1.2.3");
      expect(version1).toEqual({ major: 1, minor: 2, patch: 3 });

      const version2 = versionManager.parseVersion("2.0.0-alpha.1");
      expect(version2).toEqual({
        major: 2,
        minor: 0,
        patch: 0,
        prerelease: "alpha.1",
      });

      // Test version compatibility
      expect(versionManager.checkCompatibility("test", "^1.0.0", "1.2.3")).toBe(
        true,
      );
      expect(versionManager.checkCompatibility("test", "^1.0.0", "2.0.0")).toBe(
        false,
      );
    });

    it("should detect circular dependencies", async () => {
      // Setup circular dependency
      const MODULE_A = `
        import "moduleB.tpeg" as b
        
        grammar ModuleA {
          ruleA = b.ruleB
        }
      `;

      const MODULE_B = `
        import "moduleA.tpeg" as a
        
        grammar ModuleB {
          ruleB = a.ruleA
        }
      `;

      mockFs.addFile("/test/moduleA.tpeg", MODULE_A);
      mockFs.addFile("/test/moduleB.tpeg", MODULE_B);

      // Should detect circular dependency
      try {
        await resolver.resolveModule("/test/moduleA.tpeg");
        expect(false).toBe(true); // Should not reach here
      } catch (error: unknown) {
        expect((error as Error).name).toBe("CircularDependencyError");
      }
    });

    it("should manage namespaces correctly", () => {
      // Create mock module files for namespace testing
      const createMockModuleFile = (
        name: string,
        rules: string[],
        exports: string[],
        imports: ImportStatement[] = [],
      ) => ({
        type: "ModuleFile" as const,
        filePath: `${name}.tpeg`,
        imports,
        grammars: [
          {
            type: "ModularGrammarDefinition" as const,
            name: `${name}Grammar`,
            annotations: [],
            rules: rules.map((rule) => ({
              type: "RuleDefinition" as const,
              name: rule,
              pattern: { type: "Identifier" as const, name: "test" },
            })),
            exports:
              exports.length > 0
                ? {
                    type: "ExportDeclaration" as const,
                    rules: exports,
                  }
                : undefined,
          },
        ],
        moduleInfo: { type: "ModuleInfo" as const, version: "1.0.0" },
      });

      const baseModule = createMockModuleFile(
        "base",
        ["number", "identifier"],
        ["number"],
      );
      const mainModule = createMockModuleFile(
        "main",
        ["expression"],
        ["expression"],
        [{ type: "ImportStatement", modulePath: "base.tpeg", alias: "base" }],
      );

      namespaceManager.registerModule(baseModule);
      namespaceManager.registerModule(mainModule);

      // Test namespace conflict checking
      expect(() => {
        namespaceManager.checkNamespaceConflicts("main");
      }).not.toThrow();

      // Test qualified name resolution
      const qualifiedId = {
        type: "QualifiedIdentifier" as const,
        module: "base",
        name: "number",
      };
      const resolved = namespaceManager.resolveQualifiedName(
        qualifiedId,
        "main",
      );

      expect(resolved.rule.name).toBe("number");
      expect(resolved.moduleName).toBe("base");
      expect(resolved.isExported).toBe(true);
    });

    it("should validate version dependencies", () => {
      // Create mock module files for version testing
      const createVersionModuleFile = (
        name: string,
        version: string,
        dependencies: ImportStatement[] = [],
      ) => ({
        type: "ModuleFile" as const,
        filePath: `${name}.tpeg`,
        imports: dependencies,
        grammars: [
          {
            type: "GrammarDefinition" as const,
            name: `${name}Grammar`,
            annotations: [],
            rules: [],
          },
        ],
        moduleInfo: { type: "ModuleInfo" as const, version },
      });

      const baseModule = createVersionModuleFile("base", "1.2.0");
      const mainModule = createVersionModuleFile("main", "2.0.0", [
        { type: "ImportStatement", modulePath: "base.tpeg", version: "^1.0.0" },
      ]);

      versionManager.registerModule(baseModule);
      versionManager.registerModule(mainModule);

      // Should validate successfully
      expect(() => {
        versionManager.validateDependencies("main");
      }).not.toThrow();

      // Test incompatible version
      const incompatibleModule = createVersionModuleFile(
        "incompatible",
        "1.0.0",
        [
          {
            type: "ImportStatement",
            modulePath: "base.tpeg",
            version: "^2.0.0",
          },
        ],
      );

      versionManager.registerModule(incompatibleModule);

      expect(() => {
        versionManager.validateDependencies("incompatible");
      }).toThrow();
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete module system workflow", async () => {
      // Setup realistic module scenario
      const UTILS_MODULE = `
        grammar UtilsGrammar {
          whitespace = [ \\t\\n\\r]+
          comment = "//" [^\\n]*
        }
      `;

      const MAIN_MODULE = `
        import "utils.tpeg" as utils
        
        grammar MainGrammar {
          program = statement*
          statement = expression utils.whitespace
          expression = "test"
        }
      `;

      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);
      mockFs.addFile("/test/main.tpeg", MAIN_MODULE);

      // 1. Resolve modules
      const utilsResolved = await resolver.resolveModule("/test/utils.tpeg");
      const mainResolved = await resolver.resolveModule("/test/main.tpeg");

      expect(utilsResolved.resolved).toBe(true);
      expect(mainResolved.resolved).toBe(true);

      // 2. Test dependency graph
      const dependencyGraph =
        await resolver.getDependencyGraph("/test/main.tpeg");
      expect(dependencyGraph.get("/test/main.tpeg")).toContain(
        "/test/utils.tpeg",
      );
      expect(dependencyGraph.get("/test/utils.tpeg")).toEqual([]);

      // 3. Verify no circular dependencies
      const circularCheck =
        await resolver.checkCircularDependencies("/test/main.tpeg");
      expect(circularCheck).toBeNull();
    });

    it("should provide comprehensive error reporting", () => {
      // Test error reporting across all systems

      // Version parsing error
      try {
        versionManager.parseVersion("invalid-version");
        expect(false).toBe(true); // Should not reach here
      } catch (error: unknown) {
        expect((error as Error).name).toBe("VersionParseError");
      }

      // Namespace resolution error
      try {
        namespaceManager.resolveQualifiedName(
          { type: "QualifiedIdentifier", module: "nonexistent", name: "rule" },
          "main",
        );
        expect(false).toBe(true); // Should not reach here
      } catch (error: unknown) {
        expect((error as Error).name).toBe("QualifiedNameResolutionError");
      }

      // Version compatibility error
      const moduleFile = {
        type: "ModuleFile" as const,
        filePath: "test.tpeg",
        imports: [
          {
            type: "ImportStatement" as const,
            modulePath: "missing.tpeg",
            version: "^1.0.0",
          },
        ],
        grammars: [
          {
            type: "GrammarDefinition" as const,
            name: "TestGrammar",
            annotations: [],
            rules: [],
          },
        ],
        moduleInfo: { type: "ModuleInfo" as const, version: "1.0.0" },
      };

      versionManager.registerModule(moduleFile);

      try {
        versionManager.validateDependencies("test");
        expect(false).toBe(true); // Should not reach here
      } catch (error: unknown) {
        expect((error as Error).name).toBe("VersionCompatibilityError");
      }
    });
  });

  describe("Performance and Scalability", () => {
    it("should handle multiple modules efficiently", () => {
      // Test with multiple modules
      const moduleCount = 10;
      const modules: ModuleFile[] = [];

      for (let i = 0; i < moduleCount; i++) {
        const moduleFile = {
          type: "ModuleFile" as const,
          filePath: `module${i}.tpeg`,
          imports: [],
          grammars: [
            {
              type: "GrammarDefinition" as const,
              name: `Module${i}Grammar`,
              annotations: [],
              rules: [
                {
                  type: "RuleDefinition" as const,
                  name: `rule${i}`,
                  pattern: { type: "Identifier" as const, name: "test" },
                },
              ],
            },
          ],
          moduleInfo: { type: "ModuleInfo" as const, version: "1.0.0" },
        };

        modules.push(moduleFile);
        versionManager.registerModule(moduleFile);
      }

      // Should handle all modules efficiently
      const registeredModules = versionManager.getRegisteredModules();
      expect(registeredModules.length).toBe(moduleCount);

      // Should validate all dependencies
      expect(() => {
        versionManager.validateAllDependencies();
      }).not.toThrow();
    });
  });
});

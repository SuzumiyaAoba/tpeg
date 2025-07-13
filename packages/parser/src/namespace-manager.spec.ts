import { beforeEach, describe, expect, it } from "bun:test";
import {
  NamespaceConflictError,
  NamespaceManager,
  QualifiedNameResolutionError,
} from "./namespace-manager.js";
import type { GrammarDefinition, RuleDefinition } from "./types.js";

// テスト用の型定義
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

describe("NamespaceManager", () => {
  let manager: NamespaceManager;

  beforeEach(() => {
    manager = new NamespaceManager();
  });

  // テストデータ作成ヘルパー
  const createRule = (
    name: string,
    pattern: any = { type: "Identifier", name: "test" },
  ): RuleDefinition => ({
    type: "RuleDefinition",
    name,
    pattern,
  });

  const createGrammar = (
    name: string,
    rules: RuleDefinition[],
  ): GrammarDefinition => ({
    type: "GrammarDefinition",
    name,
    annotations: [],
    rules,
  });

  const createModularGrammar = (
    name: string,
    rules: RuleDefinition[],
    exports?: ExportDeclaration,
    imports?: ImportStatement[],
  ): ModularGrammarDefinition => ({
    type: "ModularGrammarDefinition",
    name,
    annotations: [],
    rules,
    exports,
    imports,
  });

  const createModuleFile = (
    filePath: string,
    grammars: (GrammarDefinition | ModularGrammarDefinition)[],
    imports: ImportStatement[] = [],
    moduleInfo?: ModuleInfo,
  ): ModuleFile => ({
    type: "ModuleFile",
    filePath,
    imports,
    grammars,
    moduleInfo,
  });

  const createQualifiedId = (
    module: string,
    name: string,
  ): QualifiedIdentifier => ({
    type: "QualifiedIdentifier",
    module,
    name,
  });

  describe("registerModule", () => {
    it("should register a simple module", () => {
      const rule1 = createRule("rule1");
      const rule2 = createRule("rule2");
      const grammar = createGrammar("TestGrammar", [rule1, rule2]);
      const moduleFile = createModuleFile("test.tpeg", [grammar]);

      manager.registerModule(moduleFile);

      const registeredModules = manager.getRegisteredModules();
      expect(registeredModules).toContain("test");
    });

    it("should register a module with namespace", () => {
      const rule1 = createRule("rule1");
      const grammar = createGrammar("TestGrammar", [rule1]);
      const moduleInfo: ModuleInfo = {
        type: "ModuleInfo",
        namespace: "my.namespace",
      };
      const moduleFile = createModuleFile(
        "test.tpeg",
        [grammar],
        [],
        moduleInfo,
      );

      manager.registerModule(moduleFile);

      const registeredModules = manager.getRegisteredModules();
      expect(registeredModules).toContain("my.namespace");
    });

    it("should register a module with imports and exports", () => {
      const rule1 = createRule("rule1");
      const rule2 = createRule("rule2");
      const exports: ExportDeclaration = {
        type: "ExportDeclaration",
        rules: ["rule1"],
      };
      const imports: ImportStatement[] = [
        { type: "ImportStatement", modulePath: "other.tpeg", alias: "other" },
      ];
      const grammar = createModularGrammar(
        "TestGrammar",
        [rule1, rule2],
        exports,
      );
      const moduleFile = createModuleFile("test.tpeg", [grammar], imports);

      manager.registerModule(moduleFile);

      const scope = manager.getScope("test");
      expect(scope).toBeDefined();
      expect(scope?.exports.has("rule1")).toBe(true);
      expect(scope?.exports.has("rule2")).toBe(false);
      expect(scope?.imports.get("other")).toBe("other.tpeg");
    });
  });

  describe("resolveQualifiedName", () => {
    beforeEach(() => {
      // Setup test modules
      const baseRule = createRule("baseRule");
      const baseGrammar = createModularGrammar("BaseGrammar", [baseRule], {
        type: "ExportDeclaration",
        rules: ["baseRule"],
      });
      const baseModule = createModuleFile("base.tpeg", [baseGrammar]);
      manager.registerModule(baseModule);

      const mainRule = createRule("mainRule");
      const mainGrammar = createModularGrammar("MainGrammar", [mainRule]);
      const mainModule = createModuleFile(
        "main.tpeg",
        [mainGrammar],
        [{ type: "ImportStatement", modulePath: "base.tpeg", alias: "base" }],
      );
      manager.registerModule(mainModule);
    });

    it("should resolve qualified name successfully", () => {
      const qualifiedId = createQualifiedId("base", "baseRule");
      const resolved = manager.resolveQualifiedName(qualifiedId, "main");

      expect(resolved.rule.name).toBe("baseRule");
      expect(resolved.moduleName).toBe("base");
      expect(resolved.isExported).toBe(true);
      expect(resolved.isLocal).toBe(false);
    });

    it("should throw error for unregistered module", () => {
      const qualifiedId = createQualifiedId("base", "baseRule");

      expect(() => {
        manager.resolveQualifiedName(qualifiedId, "nonexistent");
      }).toThrow(QualifiedNameResolutionError);
    });

    it("should throw error for unimported module", () => {
      const qualifiedId = createQualifiedId("unknown", "rule");

      expect(() => {
        manager.resolveQualifiedName(qualifiedId, "main");
      }).toThrow(QualifiedNameResolutionError);
    });

    it("should throw error for non-exported rule", () => {
      const privateRule = createRule("privateRule");
      const privateGrammar = createModularGrammar("PrivateGrammar", [
        privateRule,
      ]);
      const privateModule = createModuleFile("private.tpeg", [privateGrammar]);
      manager.registerModule(privateModule);

      const mainModule = createModuleFile(
        "main2.tpeg",
        [createGrammar("Main", [])],
        [
          {
            type: "ImportStatement",
            modulePath: "private.tpeg",
            alias: "priv",
          },
        ],
      );
      manager.registerModule(mainModule);

      const qualifiedId = createQualifiedId("priv", "privateRule");

      expect(() => {
        manager.resolveQualifiedName(qualifiedId, "main2");
      }).toThrow(QualifiedNameResolutionError);
    });
  });

  describe("resolveLocalRule", () => {
    beforeEach(() => {
      const rule1 = createRule("rule1");
      const rule2 = createRule("rule2");
      const grammar = createModularGrammar("TestGrammar", [rule1, rule2], {
        type: "ExportDeclaration",
        rules: ["rule1"],
      });
      const moduleFile = createModuleFile("test.tpeg", [grammar]);
      manager.registerModule(moduleFile);
    });

    it("should resolve local rule successfully", () => {
      const resolved = manager.resolveLocalRule("rule1", "test");

      expect(resolved.rule.name).toBe("rule1");
      expect(resolved.moduleName).toBe("test");
      expect(resolved.isExported).toBe(true);
      expect(resolved.isLocal).toBe(true);
    });

    it("should resolve non-exported local rule", () => {
      const resolved = manager.resolveLocalRule("rule2", "test");

      expect(resolved.rule.name).toBe("rule2");
      expect(resolved.moduleName).toBe("test");
      expect(resolved.isExported).toBe(false);
      expect(resolved.isLocal).toBe(true);
    });

    it("should throw error for non-existent rule", () => {
      expect(() => {
        manager.resolveLocalRule("nonexistent", "test");
      }).toThrow(QualifiedNameResolutionError);
    });
  });

  describe("checkNamespaceConflicts", () => {
    it("should detect namespace conflicts", () => {
      // Create two modules with same exported rule name
      const rule1 = createRule("conflictRule");
      const grammar1 = createModularGrammar("Grammar1", [rule1], {
        type: "ExportDeclaration",
        rules: ["conflictRule"],
      });
      const module1 = createModuleFile("module1.tpeg", [grammar1]);
      manager.registerModule(module1);

      const rule2 = createRule("conflictRule");
      const grammar2 = createModularGrammar("Grammar2", [rule2], {
        type: "ExportDeclaration",
        rules: ["conflictRule"],
      });
      const module2 = createModuleFile("module2.tpeg", [grammar2]);
      manager.registerModule(module2);

      // Create main module importing both
      const mainGrammar = createGrammar("MainGrammar", []);
      const mainModule = createModuleFile(
        "main.tpeg",
        [mainGrammar],
        [
          {
            type: "ImportStatement",
            modulePath: "module1.tpeg",
            alias: "mod1",
          },
          {
            type: "ImportStatement",
            modulePath: "module2.tpeg",
            alias: "mod2",
          },
        ],
      );
      manager.registerModule(mainModule);

      expect(() => {
        manager.checkNamespaceConflicts("main");
      }).toThrow(NamespaceConflictError);
    });

    it("should not detect conflicts for different rule names", () => {
      const rule1 = createRule("rule1");
      const grammar1 = createModularGrammar("Grammar1", [rule1], {
        type: "ExportDeclaration",
        rules: ["rule1"],
      });
      const module1 = createModuleFile("module1.tpeg", [grammar1]);
      manager.registerModule(module1);

      const rule2 = createRule("rule2");
      const grammar2 = createModularGrammar("Grammar2", [rule2], {
        type: "ExportDeclaration",
        rules: ["rule2"],
      });
      const module2 = createModuleFile("module2.tpeg", [grammar2]);
      manager.registerModule(module2);

      const mainGrammar = createGrammar("MainGrammar", []);
      const mainModule = createModuleFile(
        "main.tpeg",
        [mainGrammar],
        [
          {
            type: "ImportStatement",
            modulePath: "module1.tpeg",
            alias: "mod1",
          },
          {
            type: "ImportStatement",
            modulePath: "module2.tpeg",
            alias: "mod2",
          },
        ],
      );
      manager.registerModule(mainModule);

      expect(() => {
        manager.checkNamespaceConflicts("main");
      }).not.toThrow();
    });
  });

  describe("getAvailableRules", () => {
    beforeEach(() => {
      // Setup test modules
      const baseRule = createRule("baseRule");
      const baseGrammar = createModularGrammar("BaseGrammar", [baseRule], {
        type: "ExportDeclaration",
        rules: ["baseRule"],
      });
      const baseModule = createModuleFile("base.tpeg", [baseGrammar]);
      manager.registerModule(baseModule);

      const mainRule = createRule("mainRule");
      const mainGrammar = createModularGrammar("MainGrammar", [mainRule], {
        type: "ExportDeclaration",
        rules: ["mainRule"],
      });
      const mainModule = createModuleFile(
        "main.tpeg",
        [mainGrammar],
        [{ type: "ImportStatement", modulePath: "base.tpeg", alias: "base" }],
      );
      manager.registerModule(mainModule);
    });

    it("should return available rules for module", () => {
      const available = manager.getAvailableRules("main");

      expect(available.get("main")).toEqual(new Set(["mainRule"]));
      expect(available.get("base")).toEqual(new Set(["baseRule"]));
    });

    it("should return empty map for non-existent module", () => {
      const available = manager.getAvailableRules("nonexistent");
      expect(available.size).toBe(0);
    });
  });

  describe("utility methods", () => {
    it("should clear all data", () => {
      const rule = createRule("rule");
      const grammar = createGrammar("Grammar", [rule]);
      const moduleFile = createModuleFile("test.tpeg", [grammar]);
      manager.registerModule(moduleFile);

      manager.clear();

      expect(manager.getRegisteredModules()).toEqual([]);
    });

    it("should get scope for registered module", () => {
      const rule = createRule("rule");
      const grammar = createGrammar("Grammar", [rule]);
      const moduleFile = createModuleFile("test.tpeg", [grammar]);
      manager.registerModule(moduleFile);

      const scope = manager.getScope("test");
      expect(scope).toBeDefined();
      expect(scope?.currentModule).toBe("test");
    });
  });
});

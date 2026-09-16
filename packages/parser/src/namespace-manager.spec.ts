import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  NamespaceConflictError,
  NamespaceManager,
  QualifiedNameResolutionError,
} from "./namespace-manager.js";
import type { Expression, GrammarDefinition, RuleDefinition } from "./types.js";

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
    pattern: Expression = { type: "Identifier", name: "test" },
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
    ...(exports !== undefined ? { exports } : {}),
    ...(imports !== undefined ? { imports } : {}),
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
    ...(moduleInfo !== undefined ? { moduleInfo } : {}),
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

    it("throws instead of silently overwriting when two different files derive the same module name", () => {
      // Regression test: without an explicit @namespace, the module name
      // is derived from the basename alone (see extractModuleName's doc
      // comment), so two DIFFERENT files with the same filename in
      // different directories (`libA/utils.tpeg`, `libB/utils.tpeg`) used
      // to collide on the same key -- the second `registerModule` call
      // silently overwrote the first's scope/rules, so a qualified
      // reference into the first module could silently resolve into the
      // second module's (same-named, or simply absent) rules instead of
      // failing loudly or resolving correctly.
      const ruleA = createRule("greeting");
      const moduleA = createModuleFile("libA/utils.tpeg", [
        createModularGrammar("A", [ruleA], {
          type: "ExportDeclaration",
          rules: ["greeting"],
        }),
      ]);
      manager.registerModule(moduleA);

      const ruleB = createRule("farewell");
      const moduleB = createModuleFile("libB/utils.tpeg", [
        createModularGrammar("B", [ruleB], {
          type: "ExportDeclaration",
          rules: ["farewell"],
        }),
      ]);
      expect(() => manager.registerModule(moduleB)).toThrow(/ambiguous/);

      // The first module's own scope is untouched by the failed second
      // registration.
      expect(manager.getScope("utils")?.exports.has("greeting")).toBe(true);
    });

    it("re-registering the SAME filePath is not treated as a collision", () => {
      const rule1 = createRule("rule1");
      const grammar = createGrammar("TestGrammar", [rule1]);
      const moduleFile = createModuleFile("test.tpeg", [grammar]);

      manager.registerModule(moduleFile);
      expect(() => manager.registerModule(moduleFile)).not.toThrow();
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
      // A rule omitted from an explicit @export list is not exported (a
      // module with no @export at all exports ALL of its rules -- see the
      // "documented default" describe below).
      const privateRule = createRule("privateRule");
      const publicRule = createRule("publicRule");
      const privateGrammar = createModularGrammar(
        "PrivateGrammar",
        [privateRule, publicRule],
        { type: "ExportDeclaration", rules: ["publicRule"] },
      );
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

    it("does not flag a conflict when the SAME module is imported twice under two different aliases (regression: conflicts used to be grouped by alias instead of by the resolved target module, so `u1.foo`/`u2.foo` -- both unambiguously the same rule -- looked like a collision between two modules)", () => {
      const rule = createRule("foo");
      const grammar = createModularGrammar("Utils", [rule], {
        type: "ExportDeclaration",
        rules: ["foo"],
      });
      const utilsModule = createModuleFile("utils.tpeg", [grammar]);
      manager.registerModule(utilsModule);

      const mainGrammar = createGrammar("MainGrammar", []);
      const mainModule = createModuleFile(
        "main.tpeg",
        [mainGrammar],
        [
          { type: "ImportStatement", modulePath: "utils.tpeg", alias: "u1" },
          { type: "ImportStatement", modulePath: "utils.tpeg", alias: "u2" },
        ],
      );
      manager.registerModule(mainModule);

      expect(() => {
        manager.checkNamespaceConflicts("main");
      }).not.toThrow();

      // Both aliases must still resolve to the exact same rule.
      expect(
        manager.resolveQualifiedName(createQualifiedId("u1", "foo"), "main"),
      ).toEqual(
        manager.resolveQualifiedName(createQualifiedId("u2", "foo"), "main"),
      );
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

    it("allows registering a DIFFERENT file under the same derived module name after clear() (regression: clear() didn't reset moduleFilePaths, so registerModule's collision guard kept comparing against a stale filePath from before the clear and wrongly rejected the new registration)", () => {
      const rule = createRule("rule");
      const grammar = createGrammar("Grammar", [rule]);
      manager.registerModule(createModuleFile("libA/utils.tpeg", [grammar]));

      manager.clear();
      expect(manager.getRegisteredModules()).toEqual([]);

      // Same derived module name ("utils"), a DIFFERENT file -- must not
      // throw ModuleNameCollisionError, since the manager was cleared in
      // between.
      expect(() =>
        manager.registerModule(createModuleFile("libB/utils.tpeg", [grammar])),
      ).not.toThrow();
      expect(manager.getRegisteredModules()).toEqual(["utils"]);
    });
  });

  describe("explicit @namespace differing from the module's basename", () => {
    it("resolves a qualified reference through an import to a module registered under an explicit @namespace (regression: resolveQualifiedName always looked modules up by import-path basename, never finding one registered under a different explicit namespace)", () => {
      const helperRule = createRule("foo");
      const helperGrammar = createModularGrammar("G", [helperRule], {
        type: "ExportDeclaration",
        rules: ["foo"],
      });
      manager.registerModule(
        createModuleFile("lib/helpers.tpeg", [helperGrammar], [], {
          type: "ModuleInfo",
          namespace: "MyNs",
        }),
      );
      manager.registerModule(
        createModuleFile(
          "main.tpeg",
          [createGrammar("Main", [])],
          [
            {
              type: "ImportStatement",
              modulePath: "lib/helpers.tpeg",
              alias: "h",
            },
          ],
        ),
      );

      const resolved = manager.resolveQualifiedName(
        createQualifiedId("h", "foo"),
        "main",
      );
      expect(resolved.moduleName).toBe("MyNs");
      expect(resolved.rule.name).toBe("foo");
    });

    it("includes the namespaced module's exports in getAvailableRules (regression: silently missing before the fix, no error either)", () => {
      const helperRule = createRule("foo");
      const helperGrammar = createModularGrammar("G", [helperRule], {
        type: "ExportDeclaration",
        rules: ["foo"],
      });
      manager.registerModule(
        createModuleFile("lib/helpers.tpeg", [helperGrammar], [], {
          type: "ModuleInfo",
          namespace: "MyNs",
        }),
      );
      manager.registerModule(
        createModuleFile(
          "main.tpeg",
          [createGrammar("Main", [])],
          [
            {
              type: "ImportStatement",
              modulePath: "lib/helpers.tpeg",
              alias: "h",
            },
          ],
        ),
      );

      const available = manager.getAvailableRules("main");
      expect(available.get("h")).toEqual(new Set(["foo"]));
    });
  });

  describe("same-basename modules", () => {
    // Regression for issue #54: `resolveRegisteredModuleName` used to match
    // a registered module by file basename alone, so with `/proj/a/u.tpeg`
    // and `/proj/b/u.tpeg` both registered, an import of `./b/u.tpeg`
    // resolved to whichever was found first instead of the file it names.
    const registerSameBasenameModules = () => {
      const ruleA = createRule("r", { type: "StringLiteral", value: "AAA" });
      manager.registerModule(
        createModuleFile(
          "/proj/a/u.tpeg",
          [
            createModularGrammar("A", [ruleA], {
              type: "ExportDeclaration",
              rules: ["r"],
            }),
          ],
          [],
          { type: "ModuleInfo", namespace: "ns_a" },
        ),
      );
      const ruleB = createRule("r", { type: "StringLiteral", value: "BBB" });
      manager.registerModule(
        createModuleFile(
          "/proj/b/u.tpeg",
          [
            createModularGrammar("B", [ruleB], {
              type: "ExportDeclaration",
              rules: ["r"],
            }),
          ],
          [],
          { type: "ModuleInfo", namespace: "ns_b" },
        ),
      );
    };

    it("resolves a qualified reference by the import's full path, not its basename", () => {
      registerSameBasenameModules();
      manager.registerModule(
        createModuleFile(
          "/proj/c.tpeg",
          [createGrammar("Main", [])],
          [
            {
              type: "ImportStatement",
              modulePath: "./b/u.tpeg",
              alias: "x",
            },
          ],
          { type: "ModuleInfo", namespace: "main" },
        ),
      );

      const resolved = manager.resolveQualifiedName(
        createQualifiedId("x", "r"),
        "main",
      );
      expect(resolved.moduleName).toBe("ns_b");
      expect(resolved.rule.pattern).toEqual({
        type: "StringLiteral",
        value: "BBB",
      });
    });

    it("resolves `..` segments in the import path against the importer's directory", () => {
      registerSameBasenameModules();
      manager.registerModule(
        createModuleFile(
          "/proj/deep/c.tpeg",
          [createGrammar("Main", [])],
          [
            {
              type: "ImportStatement",
              modulePath: "../a/u.tpeg",
              alias: "x",
            },
          ],
          { type: "ModuleInfo", namespace: "main" },
        ),
      );

      const resolved = manager.resolveQualifiedName(
        createQualifiedId("x", "r"),
        "main",
      );
      expect(resolved.moduleName).toBe("ns_a");
    });

    it("fails loudly on a basename-only import when two same-basename modules are registered", () => {
      registerSameBasenameModules();
      manager.registerModule(
        createModuleFile(
          "/elsewhere/main.tpeg",
          [createGrammar("Main", [])],
          [
            {
              type: "ImportStatement",
              modulePath: "u.tpeg",
              alias: "x",
            },
          ],
          { type: "ModuleInfo", namespace: "main" },
        ),
      );

      expect(() =>
        manager.resolveQualifiedName(createQualifiedId("x", "r"), "main"),
      ).toThrow(/ambiguous/);
    });
  });

  describe("documented default: a module with no @export exports all rules", () => {
    // Regression for issue #56: docs/peg-grammar.md documents "(default:
    // all rules are exported)", but `exports === undefined` was treated as
    // "export nothing", so every qualified reference into a module without
    // an @export declaration failed with "is not exported".
    it("resolves a qualified reference into a module that has no @export declaration", () => {
      const rule = createRule("number");
      manager.registerModule(
        createModuleFile("/m/base.tpeg", [
          createModularGrammar("base", [rule]),
        ]),
      );
      manager.registerModule(
        createModuleFile(
          "/m/main.tpeg",
          [createGrammar("Main", [])],
          [
            {
              type: "ImportStatement",
              modulePath: "./base.tpeg",
              alias: "b",
            },
          ],
        ),
      );

      const resolved = manager.resolveQualifiedName(
        createQualifiedId("b", "number"),
        "main",
      );
      expect(resolved.rule.name).toBe("number");
      expect(resolved.isExported).toBe(true);
    });

    it("an explicit empty @export still exports nothing", () => {
      const rule = createRule("hidden");
      manager.registerModule(
        createModuleFile("/m/sealed.tpeg", [
          createModularGrammar("sealed", [rule], {
            type: "ExportDeclaration",
            rules: [],
          }),
        ]),
      );
      manager.registerModule(
        createModuleFile(
          "/m/main.tpeg",
          [createGrammar("Main", [])],
          [
            {
              type: "ImportStatement",
              modulePath: "./sealed.tpeg",
              alias: "s",
            },
          ],
        ),
      );

      expect(() =>
        manager.resolveQualifiedName(createQualifiedId("s", "hidden"), "main"),
      ).toThrow(/not exported/);
    });

    it("getAvailableRules lists every rule of a no-@export import", () => {
      manager.registerModule(
        createModuleFile("/m/base.tpeg", [
          createModularGrammar("base", [createRule("a"), createRule("b")]),
        ]),
      );
      manager.registerModule(
        createModuleFile(
          "/m/main.tpeg",
          [createGrammar("Main", [])],
          [
            {
              type: "ImportStatement",
              modulePath: "./base.tpeg",
              alias: "b",
            },
          ],
        ),
      );

      expect(manager.getAvailableRules("main").get("b")).toEqual(
        new Set(["a", "b"]),
      );
    });
  });
});

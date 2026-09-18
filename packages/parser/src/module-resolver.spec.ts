/**
 * TPEG Module Resolution Engine Tests
 *
 * Tests for module resolution, dependency tracking, and circular dependency detection.
 */

import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  CircularDependencyError,
  type FileSystemInterface,
  ModuleResolutionError,
  ModuleResolver,
  NodeFileSystem,
  createModuleResolver,
  resolveQualifiedIdentifier,
} from "./module-resolver";

// ============================================================================
// Mock File System
// ============================================================================

class MockFileSystem implements FileSystemInterface {
  private files: Map<string, string> = new Map();

  addFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  resolve(basePath: string, relativePath: string): string {
    // Simple path resolution for testing
    if (relativePath.startsWith("./")) {
      return `${basePath}/${relativePath.slice(2)}`;
    }
    if (relativePath.startsWith("../")) {
      const parts = basePath.split("/");
      parts.pop();
      return `${parts.join("/")}/${relativePath.slice(3)}`;
    }
    return `${basePath}/${relativePath}`;
  }
}

// ============================================================================
// Test Data
// ============================================================================

const BASE_MODULE = `
import "utils.tpeg" as utils

grammar Base {
  @export: [identifier, whitespace]
  
  identifier = [a-zA-Z_][a-zA-Z0-9_]*
  whitespace = [ \\t\\n\\r]+
}
`;

const UTILS_MODULE = `
grammar Utils {
  @export: [number, string_literal]
  
  number = [0-9]+
  string_literal = "\\"" [^"]* "\\""
}
`;

const ARITHMETIC_MODULE = `
import "base.tpeg" as base
import "operators.tpeg" as ops

grammar Arithmetic extends base.Base {
  @start: expression
  
  expression = base.identifier ops.add_op base.identifier
}
`;

const OPERATORS_MODULE = `
grammar Operators {
  @export: [add_op, mul_op]
  
  add_op = "+" / "-"
  mul_op = "*" / "/"
}
`;

const CIRCULAR_A = `
import "circular-b.tpeg" as b

grammar CircularA {
  rule_a = b.rule_b "a"
}
`;

const CIRCULAR_B = `
import "circular-a.tpeg" as a

grammar CircularB {
  rule_b = a.rule_a "b"
}
`;

// ============================================================================
// Tests
// ============================================================================

describe("Module Resolution Engine", () => {
  let mockFs: MockFileSystem;
  let resolver: ModuleResolver;

  beforeEach(() => {
    mockFs = new MockFileSystem();
    resolver = new ModuleResolver("/test", mockFs);
  });

  describe("ModuleResolver", () => {
    it("should resolve a simple module", async () => {
      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);

      const resolved = await resolver.resolveModule("utils.tpeg");

      expect(resolved.filePath).toBe("/test/utils.tpeg");
      expect(resolved.resolved).toBe(true);
      expect(resolved.dependencies).toEqual([]);
    });

    it("should resolve a module file saved with a UTF-8 BOM", async () => {
      // A BOM is a file-encoding artifact, not grammar content -- without
      // the strip in `loadModule`, a BOM'd module fails to parse at
      // position 0 even though its content is identical.
      mockFs.addFile("/test/utils.tpeg", `\ufeff${UTILS_MODULE}`);

      const resolved = await resolver.resolveModule("utils.tpeg");

      expect(resolved.filePath).toBe("/test/utils.tpeg");
      expect(resolved.resolved).toBe(true);
    });

    it("should resolve module with dependencies", async () => {
      mockFs.addFile("/test/base.tpeg", BASE_MODULE);
      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);

      const resolved = await resolver.resolveModule("base.tpeg");

      expect(resolved.filePath).toBe("/test/base.tpeg");
      expect(resolved.resolved).toBe(true);
      expect(resolved.dependencies).toEqual(["/test/utils.tpeg"]);
      expect(resolved.allDependencies).toContain("/test/utils.tpeg");
    });

    it("should resolve complex dependency chain", async () => {
      mockFs.addFile("/test/base.tpeg", BASE_MODULE);
      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);
      mockFs.addFile("/test/arithmetic.tpeg", ARITHMETIC_MODULE);
      mockFs.addFile("/test/operators.tpeg", OPERATORS_MODULE);

      const resolved = await resolver.resolveModule("arithmetic.tpeg");

      expect(resolved.resolved).toBe(true);
      expect(resolved.dependencies).toEqual([
        "/test/base.tpeg",
        "/test/operators.tpeg",
      ]);
      expect(resolved.allDependencies).toContain("/test/base.tpeg");
      expect(resolved.allDependencies).toContain("/test/operators.tpeg");
      expect(resolved.allDependencies).toContain("/test/utils.tpeg");
    });

    it("should resolve each relative dependency from its importing module", async () => {
      mockFs.addFile(
        "/test/main.tpeg",
        `
          import "nested/child.tpeg" as child
          grammar Main { start = child.rule }
        `,
      );
      mockFs.addFile(
        "/test/nested/child.tpeg",
        `
          import "./leaf.tpeg" as leaf
          grammar Child { rule = leaf.value }
        `,
      );
      mockFs.addFile(
        "/test/nested/leaf.tpeg",
        `grammar Leaf { value = "leaf" }`,
      );

      const resolved = await resolver.resolveModule("main.tpeg");

      expect(resolved.allDependencies).toEqual(
        new Set(["/test/nested/child.tpeg", "/test/nested/leaf.tpeg"]),
      );

      // "leaf" is an alias declared by child.tpeg, not main.tpeg -- the
      // reference must be resolved from child.tpeg's own imports.
      const childModule = resolver.context.cache.get("/test/nested/child.tpeg");
      if (!childModule) throw new Error("child.tpeg should be cached");
      const qualified = await resolveQualifiedIdentifier(
        { type: "QualifiedIdentifier", module: "leaf", name: "value" },
        childModule,
        resolver.context,
      );
      expect(qualified.module.filePath).toBe("/test/nested/leaf.tpeg");
    });

    it("should resolve an alias against the referencing module, not whichever module the cache visits first", async () => {
      // Regression test: main.tpeg and b_importer.tpeg both use the SAME
      // alias name ("shared") for two DIFFERENT modules. Resolving
      // "shared.value" from b_importer.tpeg's own imports must always find
      // b.tpeg, never a.tpeg -- regardless of dependency-resolution order.
      mockFs.addFile(
        "/test/main.tpeg",
        `
          import "a.tpeg" as shared
          import "b_importer.tpeg" as b
          grammar Main { start = shared.value }
        `,
      );
      mockFs.addFile("/test/a.tpeg", `grammar A { value = "from-a" }`);
      mockFs.addFile(
        "/test/b_importer.tpeg",
        `
          import "b.tpeg" as shared
          grammar BImporter { start = shared.value }
        `,
      );
      mockFs.addFile("/test/b.tpeg", `grammar B { value = "from-b" }`);

      await resolver.resolveModule("main.tpeg");

      const bImporterModule = resolver.context.cache.get(
        "/test/b_importer.tpeg",
      );
      if (!bImporterModule) throw new Error("b_importer.tpeg should be cached");

      const qualified = await resolveQualifiedIdentifier(
        { type: "QualifiedIdentifier", module: "shared", name: "value" },
        bImporterModule,
        resolver.context,
      );
      expect(qualified.module.filePath).toBe("/test/b.tpeg");

      // main.tpeg's own "shared" alias must still resolve to a.tpeg.
      const mainModule = resolver.context.cache.get("/test/main.tpeg");
      if (!mainModule) throw new Error("main.tpeg should be cached");
      const qualifiedFromMain = await resolveQualifiedIdentifier(
        { type: "QualifiedIdentifier", module: "shared", name: "value" },
        mainModule,
        resolver.context,
      );
      expect(qualifiedFromMain.module.filePath).toBe("/test/a.tpeg");
    });

    it("should resolve a qualified reference through the basename default alias (#111)", async () => {
      // `import "base.tpeg"` with NO `as` clause: NamespaceManager
      // registers the import under the module's basename, so `base.rule`
      // must resolve here too -- previously only `importStmt.alias` was
      // consulted and the same reference threw ModuleResolutionError.
      mockFs.addFile("/test/base.tpeg", `grammar Base { identifier = [a-z]+ }`);
      mockFs.addFile(
        "/test/main.tpeg",
        `
          import "base.tpeg"
          grammar Main { start = base.identifier }
        `,
      );

      const mainModule = await resolver.resolveModule("main.tpeg");
      const qualified = await resolveQualifiedIdentifier(
        { type: "QualifiedIdentifier", module: "base", name: "identifier" },
        mainModule,
        resolver.context,
      );
      expect(qualified.module.filePath).toBe("/test/base.tpeg");
      expect(qualified.ruleName).toBe("identifier");
    });

    it("should reject a qualified reference outside a selective import list (#110)", async () => {
      mockFs.addFile(
        "/test/base.tpeg",
        `grammar Base { identifier = [a-z]+ secret = "s" }`,
      );
      mockFs.addFile(
        "/test/main.tpeg",
        `
          import "base.tpeg" { identifier }
          grammar Main { start = base.identifier t = base.secret }
        `,
      );

      const mainModule = await resolver.resolveModule("main.tpeg");
      const listed = await resolveQualifiedIdentifier(
        { type: "QualifiedIdentifier", module: "base", name: "identifier" },
        mainModule,
        resolver.context,
      );
      expect(listed.ruleName).toBe("identifier");

      await expect(
        resolveQualifiedIdentifier(
          { type: "QualifiedIdentifier", module: "base", name: "secret" },
          mainModule,
          resolver.context,
        ),
      ).rejects.toThrow(/not in the selective import list/);
    });

    it("should cache resolved modules", async () => {
      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);

      const resolved1 = await resolver.resolveModule("utils.tpeg");
      const resolved2 = await resolver.resolveModule("utils.tpeg");

      expect(resolved1).toBe(resolved2);
    });

    it("should detect circular dependencies", async () => {
      mockFs.addFile("/test/circular-a.tpeg", CIRCULAR_A);
      mockFs.addFile("/test/circular-b.tpeg", CIRCULAR_B);

      await expect(resolver.resolveModule("circular-a.tpeg")).rejects.toThrow(
        CircularDependencyError,
      );
    });

    it("should throw error for missing module", async () => {
      await expect(resolver.resolveModule("missing.tpeg")).rejects.toThrow(
        ModuleResolutionError,
      );
    });

    it("should reject a module file with unconsumed trailing content", async () => {
      // `tpegModuleFile` is a prefix parser: without a full-consumption
      // check, `grammar G { ... }\nGARBAGE` loads "successfully" with the
      // trailing text silently dropped.
      mockFs.addFile(
        "/test/trailing.tpeg",
        `grammar G { r = "x" }\nGARBAGE TRAILING`,
      );

      await expect(resolver.resolveModule("trailing.tpeg")).rejects.toThrow(
        ModuleResolutionError,
      );
      await expect(resolver.resolveModule("trailing.tpeg")).rejects.toThrow(
        /unexpected content at line 2, column 0/,
      );
    });

    it("should attach a transforms block placed after the grammar block", async () => {
      // `tpegFile` (index.ts) accepts `grammar { ... }` followed by
      // top-level `transforms` blocks and merges them into
      // `grammar.transforms` -- a module file is the same file format plus
      // imports, so `tpegModuleFile` does the same (#112). Previously this
      // was a silent data-loss path: the grammar parsed, the trailing
      // block was left over, and the resolver's whole-file check rejected
      // the file entirely.
      mockFs.addFile(
        "/test/misplaced.tpeg",
        `grammar G {
  __transformed = "a"
  m = __transformed
}
transforms T@typescript {
  m(captures: any) -> Result<any> { return { success: true, value: 1 }; }
}`,
      );

      const resolved = await resolver.resolveModule("misplaced.tpeg");

      expect(resolved.resolved).toBe(true);
      const grammar = resolved.content.grammars[0];
      expect(grammar?.transforms).toHaveLength(1);
      expect(grammar?.transforms?.[0]?.transformSet.name).toBe("T");
    });

    it("should still reject trailing garbage that is not a transforms block", async () => {
      mockFs.addFile(
        "/test/garbage.tpeg",
        `grammar G {
  r = "a"
}
this is not a transforms block`,
      );

      await expect(resolver.resolveModule("garbage.tpeg")).rejects.toThrow(
        ModuleResolutionError,
      );
      await expect(resolver.resolveModule("garbage.tpeg")).rejects.toThrow(
        /unexpected content at line 4, column 0/,
      );
    });

    it("should still accept trailing whitespace and comments", async () => {
      mockFs.addFile(
        "/test/clean.tpeg",
        `grammar G { r = "x" } // done\n/* trailing block */\n`,
      );

      const resolved = await resolver.resolveModule("clean.tpeg");

      expect(resolved.resolved).toBe(true);
      expect(resolved.content.grammars).toHaveLength(1);
    });

    it("should still fall back to imports-only when the grammar half cannot be parsed", async () => {
      // Existing behavior preserved: a file whose grammar block doesn't
      // parse at all still resolves its imports so dependency resolution
      // keeps working.
      mockFs.addFile(
        "/test/no-grammar.tpeg",
        `import "dep.tpeg" as dep\nthis is not a grammar block`,
      );
      mockFs.addFile("/test/dep.tpeg", `grammar D { d = "x" }`);

      const resolved = await resolver.resolveModule("no-grammar.tpeg");

      expect(resolved.content.imports).toHaveLength(1);
      expect(resolved.content.grammars).toHaveLength(0);
    });

    it("should not extract imports from inside block comments", async () => {
      // Regression test: the old line-based scan treated a commented-out
      // `import` line inside `/* ... *\/` as a real dependency, so
      // resolution failed with "Module file not found: phantom.tpeg",
      // masking the file's actual syntax error.
      mockFs.addFile(
        "/test/bad.tpeg",
        `/*
import "phantom.tpeg" as ghost
*/
import "dep.tpeg" as dep
grammar Bad { !!! }`,
      );
      mockFs.addFile("/test/dep.tpeg", `grammar D { d = "x" }`);

      const resolved = await resolver.resolveModule("bad.tpeg");

      expect(resolved.dependencies).toEqual(["/test/dep.tpeg"]);
      expect(resolved.content.imports).toHaveLength(1);
      expect(resolved.content.imports[0]?.modulePath).toBe("dep.tpeg");
    });

    it("should not extract line-commented imports in the fallback scan", async () => {
      mockFs.addFile(
        "/test/commented.tpeg",
        `// import "phantom.tpeg" as ghost
import "dep.tpeg" as dep
grammar Bad { !!! }`,
      );
      mockFs.addFile("/test/dep.tpeg", `grammar D { d = "x" }`);

      const resolved = await resolver.resolveModule("commented.tpeg");

      expect(resolved.content.imports).toHaveLength(1);
      expect(resolved.dependencies).toEqual(["/test/dep.tpeg"]);
    });

    it("should surface the real syntax error when the fallback finds no imports", async () => {
      // A file whose grammar can't be parsed AND declares no imports has
      // nothing for the imports-only fallback to resolve -- report the
      // original parse error rather than resolving to an empty module.
      mockFs.addFile(
        "/test/broken.tpeg",
        `grammar Bad {\n  r = "a" oops!!! not valid\n}`,
      );

      await expect(resolver.resolveModule("broken.tpeg")).rejects.toThrow(
        ModuleResolutionError,
      );
      await expect(resolver.resolveModule("broken.tpeg")).rejects.toThrow(
        /Failed to parse module file/,
      );
    });

    it("should resolve multiple modules", async () => {
      mockFs.addFile("/test/base.tpeg", BASE_MODULE);
      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);
      mockFs.addFile("/test/operators.tpeg", OPERATORS_MODULE);

      const resolved = await resolver.resolveModules([
        "base.tpeg",
        "utils.tpeg",
        "operators.tpeg",
      ]);

      expect(resolved.size).toBe(3);
      expect(resolved.has("base.tpeg")).toBe(true);
      expect(resolved.has("utils.tpeg")).toBe(true);
      expect(resolved.has("operators.tpeg")).toBe(true);
    });

    it("should build dependency graph", async () => {
      mockFs.addFile("/test/base.tpeg", BASE_MODULE);
      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);
      mockFs.addFile("/test/arithmetic.tpeg", ARITHMETIC_MODULE);
      mockFs.addFile("/test/operators.tpeg", OPERATORS_MODULE);

      const graph = await resolver.getDependencyGraph("arithmetic.tpeg");

      expect(graph.get("/test/arithmetic.tpeg")).toEqual([
        "/test/base.tpeg",
        "/test/operators.tpeg",
      ]);
      expect(graph.get("/test/base.tpeg")).toEqual(["/test/utils.tpeg"]);
      expect(graph.get("/test/utils.tpeg")).toEqual([]);
      expect(graph.get("/test/operators.tpeg")).toEqual([]);
    });

    it("should check for circular dependencies", async () => {
      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);
      mockFs.addFile("/test/circular-a.tpeg", CIRCULAR_A);
      mockFs.addFile("/test/circular-b.tpeg", CIRCULAR_B);

      const noCycle = await resolver.checkCircularDependencies("utils.tpeg");
      expect(noCycle).toBeNull();

      const cycle = await resolver.checkCircularDependencies("circular-a.tpeg");
      expect(cycle).not.toBeNull();
      expect(cycle).toContain("/test/circular-a.tpeg");
      expect(cycle).toContain("/test/circular-b.tpeg");
    });

    it("should clear cache", async () => {
      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);

      await resolver.resolveModule("utils.tpeg");
      expect(resolver.context.cache.size).toBe(1);

      resolver.clearCache();
      expect(resolver.context.cache.size).toBe(0);
      expect(resolver.context.resolving.size).toBe(0);
    });
  });

  describe("createModuleResolver", () => {
    it("should create resolver with default file system", () => {
      const resolver = createModuleResolver("/test");
      expect(resolver).toBeInstanceOf(ModuleResolver);
      expect(resolver.context.baseDir).toBe("/test");
    });
  });

  describe("Error Classes", () => {
    it("should create ModuleResolutionError", () => {
      const error = new ModuleResolutionError("Test error", "test.tpeg");
      expect(error.message).toBe("Test error");
      expect(error.modulePath).toBe("test.tpeg");
      expect(error).toBeInstanceOf(Error);
    });

    it("should create CircularDependencyError", () => {
      const cycle = ["a.tpeg", "b.tpeg", "c.tpeg"];
      const error = new CircularDependencyError(cycle);
      expect(error.cycle).toEqual(cycle);
      expect(error.message).toContain("Circular dependency detected");
      expect(error).toBeInstanceOf(ModuleResolutionError);
    });
  });

  describe("NodeFileSystem", () => {
    it("resolves a relative path against a base directory without using require()", () => {
      // NodeFileSystem is exported as "type": "module", so any use of the
      // CommonJS `require` function here would throw under real Node.js ESM
      // (Bun happens to polyfill it, which is why a bug here could pass
      // under `bun test` while still breaking real Node consumers).
      const fs = new NodeFileSystem();
      expect(fs.resolve("/a/b", "../c/d.tpeg")).toBe("/a/c/d.tpeg");
      expect(fs.resolve("/a/b", "./sibling.tpeg")).toBe("/a/b/sibling.tpeg");
    });
  });
});

/**
 * TPEG Module Resolution Engine Tests
 *
 * Tests for module resolution, dependency tracking, and circular dependency detection.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
  ModuleResolver,
  ModuleResolutionError,
  CircularDependencyError,
  createModuleResolver,
  type FileSystemInterface,
  type ResolvedModule,
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
      return basePath + "/" + relativePath.slice(2);
    }
    if (relativePath.startsWith("../")) {
      const parts = basePath.split("/");
      parts.pop();
      return parts.join("/") + "/" + relativePath.slice(3);
    }
    return basePath + "/" + relativePath;
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
      expect(resolved.dependencies).toEqual(["/test/base.tpeg", "/test/operators.tpeg"]);
      expect(resolved.allDependencies).toContain("/test/base.tpeg");
      expect(resolved.allDependencies).toContain("/test/operators.tpeg");
      expect(resolved.allDependencies).toContain("/test/utils.tpeg");
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

    it("should resolve multiple modules", async () => {
      mockFs.addFile("/test/base.tpeg", BASE_MODULE);
      mockFs.addFile("/test/utils.tpeg", UTILS_MODULE);
      mockFs.addFile("/test/operators.tpeg", OPERATORS_MODULE);

      const resolved = await resolver.resolveModules([
        "base.tpeg",
        "utils.tpeg", 
        "operators.tpeg"
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
        "/test/operators.tpeg"
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
}); 
/**
 * TPEG Module Resolution Engine
 *
 * Handles module resolution, dependency tracking, and circular dependency detection
 * for the TPEG module system.
 *
 * Features:
 * - File path resolution
 * - Dependency graph construction
 * - Circular dependency detection
 * - Module loading and caching
 * - Version constraint validation
 */

import {
  dirname,
  isAbsolute,
  normalize,
  resolve as resolvePath,
} from "node:path";
import type {
  ImportStatement,
  ModuleFile,
  QualifiedIdentifier,
} from "@suzumiyaaoba/tpeg-core";
import { parseGrammarFile, stripFileBom } from "./grammar-file";
import { skipGrammarTrivia } from "./whitespace-utils";
import { importStatement } from "./module";
import { moduleNameFromPath } from "./path-utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a resolved module with its metadata
 */
export interface ResolvedModule {
  /** The file path of the module */
  filePath: string;
  /** The parsed module content */
  content: ModuleFile;
  /** Direct dependencies of this module */
  dependencies: string[];
  /** All transitive dependencies */
  allDependencies: Set<string>;
  /** Whether this module has been fully resolved */
  resolved: boolean;
}

/**
 * Module resolution context
 */
export interface ModuleResolutionContext {
  /** Base directory for resolving relative paths */
  baseDir: string;
  /** Module cache to avoid re-parsing. Replaced by clearCache; active
   * resolutions retain the previous map until they finish. */
  cache: Map<string, ResolvedModule>;
  /** Currently resolving modules in this cache generation (for cycle
   * detection). Replaced alongside the cache by clearCache. */
  resolving: Set<string>;
  /** File system interface */
  fileSystem: FileSystemInterface;
  /**
   * Tail of the queue serializing top-level {@link ModuleResolver.resolveModule}
   * calls that share this context. `resolving` (above) is the DFS stack of
   * ONE resolution; two concurrent resolutions interleaving on it made
   * each see the other's in-progress modules and throw a bogus
   * `CircularDependencyError` (e.g. `Promise.all([r.resolveModule("c"),
   * r.resolveModule("d")])` where `c` imports `d`).
   */
  queue?: Promise<unknown>;
}

/**
 * File system interface for module loading
 */
export interface FileSystemInterface {
  /** Read file content */
  readFile(path: string): Promise<string>;
  /** Check if file exists */
  exists(path: string): Promise<boolean>;
  /** Resolve relative path */
  resolve(basePath: string, relativePath: string): string;
}

/**
 * Module resolution error
 */
export class ModuleResolutionError extends Error {
  public readonly modulePath: string;

  constructor(message: string, modulePath: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ModuleResolutionError";
    this.modulePath = modulePath;
  }
}

/**
 * Circular dependency error
 */
export class CircularDependencyError extends ModuleResolutionError {
  public readonly cycle: string[];

  constructor(cycle: string[]) {
    super(
      `Circular dependency detected: ${cycle.join(" -> ")} -> ${cycle[0]}`,
      cycle[0] ?? "",
    );
    this.name = "CircularDependencyError";
    this.cycle = cycle;
  }
}

// ============================================================================
// Module Resolution Engine
// ============================================================================

/**
 * TPEG Module Resolution Engine
 */
export class ModuleResolver {
  public context: ModuleResolutionContext;

  constructor(baseDir: string, fileSystem: FileSystemInterface) {
    this.context = {
      baseDir,
      cache: new Map(),
      resolving: new Set(),
      fileSystem,
    };
  }

  /**
   * Resolve a module and all its dependencies
   *
   * @param modulePath - The path to the module to resolve
   * @returns Promise<ResolvedModule> The resolved module
   */
  async resolveModule(modulePath: string): Promise<ResolvedModule> {
    return this.enqueueResolution(modulePath, (module) => module);
  }

  private async resolveModuleInternal(
    modulePath: string,
    context: ModuleResolutionContext,
  ): Promise<ResolvedModule> {
    const normalizedPath = this.normalizePath(modulePath, context);

    // Check cache first
    const cached = context.cache.get(normalizedPath);
    if (cached?.resolved) {
      return cached;
    }

    // Check for circular dependency
    if (context.resolving.has(normalizedPath)) {
      const cycle = Array.from(context.resolving);
      const cycleStart = cycle.indexOf(normalizedPath);
      throw new CircularDependencyError(cycle.slice(cycleStart));
    }

    // Mark as resolving
    context.resolving.add(normalizedPath);

    try {
      // Load and parse the module
      const content = await this.loadModule(normalizedPath, context);

      // Extract dependencies
      const dependencies = this.extractDependencies(content, context);

      // Create resolved module entry
      const resolvedModule: ResolvedModule = {
        filePath: normalizedPath,
        content,
        dependencies,
        allDependencies: new Set(),
        resolved: false,
      };

      // Resolve dependencies recursively
      for (const depPath of dependencies) {
        const resolvedDep = await this.resolveModuleInternal(depPath, context);
        resolvedModule.allDependencies.add(resolvedDep.filePath);

        // Add transitive dependencies
        for (const transitiveDep of resolvedDep.allDependencies) {
          resolvedModule.allDependencies.add(transitiveDep);
        }
      }

      // Cache only complete modules. Missing dependencies and cycles must
      // not leave unusable entries behind; successfully resolved children
      // remain cached and can be reused after the problem is repaired.
      resolvedModule.resolved = true;
      context.cache.set(normalizedPath, resolvedModule);

      return resolvedModule;
    } finally {
      // Remove from resolving set
      context.resolving.delete(normalizedPath);
    }
  }

  /**
   * Resolve multiple modules
   *
   * @param modulePaths - Array of module paths to resolve
   * @returns Promise<Map<string, ResolvedModule>> Map of resolved modules
   */
  async resolveModules(
    modulePaths: string[],
  ): Promise<Map<string, ResolvedModule>> {
    const resolved = new Map<string, ResolvedModule>();

    for (const modulePath of modulePaths) {
      const resolvedModule = await this.resolveModule(modulePath);
      resolved.set(modulePath, resolvedModule);
    }

    return resolved;
  }

  /**
   * Get the requested module's dependency graph, including its transitive
   * dependencies. Returned arrays can be edited without changing the cache.
   *
   * @param modulePath - The module to analyze
   * @returns Promise<Map<string, string[]>> Dependency graph
   */
  async getDependencyGraph(modulePath: string): Promise<Map<string, string[]>> {
    return this.enqueueResolution(modulePath, (root, context) => {
      const graph = new Map<string, string[]>([
        [root.filePath, [...root.dependencies]],
      ]);
      for (const path of root.allDependencies) {
        const module = context.cache.get(path);
        if (module?.resolved) {
          graph.set(path, [...module.dependencies]);
        }
      }
      return graph;
    });
  }

  /**
   * Check if a module has circular dependencies
   *
   * @param modulePath - The module to check
   * @returns Promise<string[] | null> Cycle path if found, null otherwise
   */
  async checkCircularDependencies(
    modulePath: string,
  ): Promise<string[] | null> {
    try {
      await this.resolveModule(modulePath);
      return null;
    } catch (error) {
      if (error instanceof CircularDependencyError) {
        return error.cycle;
      }
      throw error;
    }
  }

  /**
   * Clear the module cache. Calls already running finish with their own
   * cache and cycle-detection state; subsequent calls reload modules.
   */
  clearCache(): void {
    this.context.cache = new Map();
    this.context.resolving = new Set();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /** Serialize resolutions sharing a context, including graph reads.
   * Capture the maps when a queued job starts: clearCache can replace
   * them during I/O without erasing an active DFS stack or letting old
   * reads populate the new cache. The result callback uses those same
   * maps, so an invalidation cannot truncate a dependency graph. */
  private enqueueResolution<T>(
    modulePath: string,
    result: (module: ResolvedModule, context: ModuleResolutionContext) => T,
  ): Promise<T> {
    const owner = this.context;
    const previous = owner.queue ?? Promise.resolve();
    const resolve = async (): Promise<T> => {
      const context = { ...owner };
      const module = await this.resolveModuleInternal(modulePath, context);
      return result(module, context);
    };
    const run = previous.then(resolve, resolve);
    // The queue tracks completion only, avoiding a retained module or
    // graph result after its cache has been cleared.
    owner.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Normalize module path
   */
  private normalizePath(
    modulePath: string,
    context: ModuleResolutionContext,
    baseDir = context.baseDir,
  ): string {
    // An absolute path is still normalized: returned as-is, `/p/./b.tpeg`
    // and `/p/sub/../b.tpeg` became cache keys distinct from `/p/b.tpeg`,
    // loading (and listing as a dependency) the same file several times.
    if (isAbsolute(modulePath)) {
      return normalize(modulePath);
    }

    // Resolve relative paths
    return context.fileSystem.resolve(baseDir, modulePath);
  }

  /**
   * Load and parse a module file
   */
  private async loadModule(
    filePath: string,
    context: ModuleResolutionContext,
  ): Promise<ModuleFile> {
    try {
      // Check if file exists
      if (!(await context.fileSystem.exists(filePath))) {
        throw new ModuleResolutionError(
          `Module file not found: ${filePath}`,
          filePath,
        );
      }

      const content = await context.fileSystem.readFile(filePath);
      const result = parseGrammarFile(filePath, content);
      if (result.success) return result.val;

      const location = `line ${result.line}, column ${result.column}`;
      if (result.kind === "trailing") {
        const { expected } = result.error;
        const hint = Array.isArray(expected) ? expected.join(" or ") : expected;
        throw new ModuleResolutionError(
          `Failed to parse module file "${filePath}": unexpected content at ${location}${hint ? ` (expected ${hint})` : ""}`,
          filePath,
        );
      }
      // Dependencies can still be resolved from the imports of an unsupported
      // grammar. Never apply this fallback to an otherwise valid, truncated file.
      if (!result.error.abort) {
        const imports = this.parseImports(stripFileBom(content));
        if (imports.length > 0)
          return { type: "ModuleFile", filePath, imports, grammars: [] };
      }
      throw new ModuleResolutionError(
        `Failed to parse module file "${filePath}" at ${location}: ${result.error.message}`,
        filePath,
      );
    } catch (error) {
      if (error instanceof ModuleResolutionError) {
        throw error;
      }
      throw new ModuleResolutionError(
        `Failed to load module: ${filePath}`,
        filePath,
        error,
      );
    }
  }

  /**
   * Extract dependencies from module content
   */
  private extractDependencies(
    moduleFile: ModuleFile,
    context: ModuleResolutionContext,
  ): string[] {
    const dependencies = new Set<string>();
    const importingDirectory = dirname(moduleFile.filePath);

    for (const importStmt of moduleFile.imports) {
      const dependency = this.normalizePath(
        importStmt.modulePath,
        context,
        importingDirectory,
      );
      // The same file imported twice (e.g. under two aliases) is still
      // one dependency.
      dependencies.add(dependency);
    }

    return [...dependencies];
  }

  /**
   * Parse import statements from module content.
   *
   * Fallback for when `tpegModuleFile` can't parse the file at all, so
   * dependency resolution still sees the imports of a module whose
   * grammar block uses not-yet-supported syntax.
   *
   * Scans only the leading import section -- the same run of
   * (trivia, import) pairs `tpegModuleFile` itself parses -- using the
   * real `importStatement` parser at each candidate position, rather
   * than the old line-by-line `startsWith("import ")` matching, which
   * also picked up `import` lines inside `/* ... *\/` block comments
   * and treated commented-out imports as real dependencies (masking the
   * file's actual syntax error behind a phantom "module not found" for
   * the fake path).
   */
  private parseImports(content: string): ImportStatement[] {
    const imports: ImportStatement[] = [];
    let pos = 0;
    while (pos < content.length) {
      const start = skipGrammarTrivia(content, pos);
      const result = importStatement(content, start);
      if (!result.success) break;
      imports.push(result.val);
      pos = result.next;
    }
    return imports;
  }
}

// ============================================================================
// Default File System Implementation
// ============================================================================

/**
 * Node.js file system implementation
 */
export class NodeFileSystem implements FileSystemInterface {
  async readFile(path: string): Promise<string> {
    const fs = await import("node:fs/promises");
    return fs.readFile(path, "utf-8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      const fs = await import("node:fs/promises");
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  resolve(basePath: string, relativePath: string): string {
    return resolvePath(basePath, relativePath);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a module resolver with default settings
 *
 * @param baseDir - Base directory for module resolution
 * @returns ModuleResolver instance
 */
export function createModuleResolver(baseDir: string): ModuleResolver {
  return new ModuleResolver(baseDir, new NodeFileSystem());
}

/**
 * Resolve qualified identifier to module and rule name
 *
 * `fromModule` is the module the `QualifiedIdentifier` reference actually
 * appears in -- its own `imports` are the ONLY place `qualifiedId.module`
 * (an import alias) can mean anything, since import aliases are local to
 * the module that declares them. An earlier version of this function
 * searched every resolved module in `context.cache` for ANY import whose
 * alias matched, regardless of which module the reference came from: if
 * two different modules in the same dependency graph happen to import
 * different targets under the same alias name, that scan would resolve to
 * whichever one the cache happened to iterate to first -- silently wrong
 * for the other -- rather than reporting an ambiguity or simply asking the
 * one module that actually knows.
 *
 * @param qualifiedId - The qualified identifier to resolve
 * @param fromModule - The already-resolved module `qualifiedId` was referenced from
 * @param context - Module resolution context
 * @returns Promise<{module: ResolvedModule, ruleName: string}> Resolved reference
 */
export async function resolveQualifiedIdentifier(
  qualifiedId: QualifiedIdentifier,
  fromModule: ResolvedModule,
  context: ModuleResolutionContext,
): Promise<{ module: ResolvedModule; ruleName: string }> {
  for (const importStmt of fromModule.content.imports) {
    // The effective alias defaults to the module's basename (minus
    // `.tpeg`) when no `as` clause is given -- the same default
    // `NamespaceManager.registerModule` applies, so `import "base.tpeg"`
    // makes `base.<rule>` resolvable through BOTH resolvers (#111).
    const effectiveAlias =
      importStmt.alias ?? moduleNameFromPath(importStmt.modulePath);
    if (effectiveAlias === qualifiedId.module) {
      // A selective import exposes only its listed rules
      // (`import "m.tpeg" { r1, r2 }`) -- `NamespaceManager.
      // resolveQualifiedName` applies the same restriction (#110).
      if (
        importStmt.selective !== undefined &&
        !importStmt.selective.includes(qualifiedId.name)
      ) {
        throw new ModuleResolutionError(
          `Cannot resolve qualified identifier: ${qualifiedId.module}.${qualifiedId.name} -- '${qualifiedId.name}' is not in the selective import list of '${qualifiedId.module}' (referenced from ${fromModule.filePath})`,
          qualifiedId.module,
        );
      }
      // Resolve the imported module, relative to the REFERENCING module's
      // own directory -- matching `extractDependencies`'s own relative-path
      // handling above.
      const resolver = new ModuleResolver(context.baseDir, context.fileSystem);
      resolver.context = context;
      const importedPath = isAbsolute(importStmt.modulePath)
        ? normalize(importStmt.modulePath)
        : context.fileSystem.resolve(
            dirname(fromModule.filePath),
            importStmt.modulePath,
          );
      const importedModule = await resolver.resolveModule(importedPath);

      return {
        module: importedModule,
        ruleName: qualifiedId.name,
      };
    }
  }

  throw new ModuleResolutionError(
    `Cannot resolve qualified identifier: ${qualifiedId.module}.${qualifiedId.name} (referenced from ${fromModule.filePath})`,
    qualifiedId.module,
  );
}

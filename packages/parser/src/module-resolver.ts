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

import { dirname, resolve as resolvePath } from "node:path";
import type {
  ImportStatement,
  ModuleFile,
  QualifiedIdentifier,
} from "@suzumiyaaoba/tpeg-core";
import { offsetToPos, parse } from "@suzumiyaaoba/tpeg-core";
import { skipTrailingWhitespaceAndComments, tpegModuleFile } from "./grammar";
import { importStatement } from "./module";

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
  /** Module cache to avoid re-parsing */
  cache: Map<string, ResolvedModule>;
  /** Currently resolving modules (for cycle detection) */
  resolving: Set<string>;
  /** File system interface */
  fileSystem: FileSystemInterface;
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

  constructor(message: string, modulePath: string, _cause?: Error) {
    super(message);
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
    const normalizedPath = this.normalizePath(modulePath);

    // Check cache first
    const cached = this.context.cache.get(normalizedPath);
    if (cached?.resolved) {
      return cached;
    }

    // Check for circular dependency
    if (this.context.resolving.has(normalizedPath)) {
      const cycle = Array.from(this.context.resolving);
      const cycleStart = cycle.indexOf(normalizedPath);
      throw new CircularDependencyError(cycle.slice(cycleStart));
    }

    // Mark as resolving
    this.context.resolving.add(normalizedPath);

    try {
      // Load and parse the module
      const content = await this.loadModule(normalizedPath);

      // Extract dependencies
      const dependencies = this.extractDependencies(content);

      // Create resolved module entry
      const resolvedModule: ResolvedModule = {
        filePath: normalizedPath,
        content,
        dependencies,
        allDependencies: new Set(),
        resolved: false,
      };

      // Add to cache
      this.context.cache.set(normalizedPath, resolvedModule);

      // Resolve dependencies recursively
      for (const depPath of dependencies) {
        const resolvedDep = await this.resolveModule(depPath);
        resolvedModule.allDependencies.add(resolvedDep.filePath);

        // Add transitive dependencies
        for (const transitiveDep of resolvedDep.allDependencies) {
          resolvedModule.allDependencies.add(transitiveDep);
        }
      }

      // Mark as resolved
      resolvedModule.resolved = true;

      return resolvedModule;
    } finally {
      // Remove from resolving set
      this.context.resolving.delete(normalizedPath);
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
   * Get the dependency graph for a module
   *
   * @param modulePath - The module to analyze
   * @returns Promise<Map<string, string[]>> Dependency graph
   */
  async getDependencyGraph(modulePath: string): Promise<Map<string, string[]>> {
    await this.resolveModule(modulePath);
    const graph = new Map<string, string[]>();

    // Build graph from cache
    for (const [path, module] of this.context.cache) {
      if (module.resolved) {
        graph.set(path, module.dependencies);
      }
    }

    return graph;
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
   * Clear the module cache
   */
  clearCache(): void {
    this.context.cache.clear();
    this.context.resolving.clear();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Normalize module path
   */
  private normalizePath(
    modulePath: string,
    baseDir = this.context.baseDir,
  ): string {
    // If it's an absolute path, return as-is
    if (modulePath.startsWith("/")) {
      return modulePath;
    }

    // Resolve relative paths
    return this.context.fileSystem.resolve(baseDir, modulePath);
  }

  /**
   * Load and parse a module file
   */
  private async loadModule(filePath: string): Promise<ModuleFile> {
    try {
      // Check if file exists
      if (!(await this.context.fileSystem.exists(filePath))) {
        throw new ModuleResolutionError(
          `Module file not found: ${filePath}`,
          filePath,
        );
      }

      // Read file content
      const content = await this.context.fileSystem.readFile(filePath);

      // Parse imports + the grammar block together, so the resolved module's
      // rules and @export declarations are actually available (e.g. to
      // NamespaceManager.registerModule). Grammar syntax not yet supported by
      // modularGrammarDefinition (extends, unquoted annotation values,
      // qualified identifiers in rule bodies) falls back to imports-only, so
      // dependency resolution still works even when the grammar half can't
      // be parsed.
      const fullParse = parse(tpegModuleFile)(content);
      // `parse()` only requires `tpegModuleFile` to match a PREFIX of the
      // file (see `packages/core/src/utils.ts`'s `parse`), so content after
      // the grammar block's closing "}" -- a misplaced `transforms` block, a
      // typo'd second `grammar` block, arbitrary garbage -- would otherwise
      // be silently dropped, leaving the module "loaded" with a truncated
      // grammar. Require full consumption exactly the way the CLI does for
      // `tpegFile` (`packages/cli/src/cli.ts`): only trailing whitespace and
      // comments may remain.
      const trailingEnd = fullParse.success
        ? skipTrailingWhitespaceAndComments(content, fullParse.next)
        : content.length;
      if (fullParse.success && trailingEnd !== content.length) {
        const { line, column } = offsetToPos(content, trailingEnd);
        throw new ModuleResolutionError(
          `Failed to parse module file "${filePath}": unexpected content at line ${line}, column ${column} (the import/grammar block(s) before this point parsed successfully, but did not consume the rest of the file)`,
          filePath,
        );
      }
      let moduleFile: ModuleFile;
      if (fullParse.success) {
        moduleFile = {
          type: "ModuleFile",
          filePath,
          imports: fullParse.val.imports,
          grammars: [fullParse.val.grammar],
          // NamespaceManager and VersionManager both read moduleInfo off
          // the ModuleFile, not off the grammar block, so it has to be
          // lifted here for @version to actually reach them.
          ...(fullParse.val.grammar.moduleInfo
            ? { moduleInfo: fullParse.val.grammar.moduleInfo }
            : {}),
        };
      } else {
        const imports = this.parseImports(content);
        if (imports.length === 0) {
          // The imports-only fallback exists to keep dependency resolution
          // working when the grammar half uses syntax
          // `modularGrammarDefinition` doesn't support yet -- but a file
          // with no imports at all has nothing to resolve, so surface the
          // real syntax error instead of producing an empty module that
          // masks it.
          const { line, column } = offsetToPos(content, fullParse.error.pos);
          throw new ModuleResolutionError(
            `Failed to parse module file "${filePath}" at line ${line}, column ${column}: ${fullParse.error.message}`,
            filePath,
          );
        }
        moduleFile = {
          type: "ModuleFile",
          filePath,
          imports,
          grammars: [],
        };
      }

      return moduleFile;
    } catch (error) {
      if (error instanceof ModuleResolutionError) {
        throw error;
      }
      throw new ModuleResolutionError(
        `Failed to load module: ${filePath}`,
        filePath,
        error as Error,
      );
    }
  }

  /**
   * Extract dependencies from module content
   */
  private extractDependencies(moduleFile: ModuleFile): string[] {
    const dependencies: string[] = [];
    const importingDirectory = dirname(moduleFile.filePath);

    for (const importStmt of moduleFile.imports) {
      dependencies.push(
        this.normalizePath(importStmt.modulePath, importingDirectory),
      );
    }

    return dependencies;
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
      const start = skipTrailingWhitespaceAndComments(content, pos);
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
      importStmt.alias ??
      importStmt.modulePath
        .split("/")
        .pop()
        ?.replace(/\.tpeg$/, "");
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
      const importedPath = importStmt.modulePath.startsWith("/")
        ? importStmt.modulePath
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

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

import type {
  ImportStatement,
  ModuleFile,
  ModularGrammarDefinition,
  GrammarDefinition,
  QualifiedIdentifier,
} from "tpeg-core";
import { parse as parseCore } from "tpeg-core";
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

  constructor(
    message: string,
    modulePath: string,
    cause?: Error,
  ) {
    super(message);
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

  constructor(
    baseDir: string,
    fileSystem: FileSystemInterface,
  ) {
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
  async resolveModules(modulePaths: string[]): Promise<Map<string, ResolvedModule>> {
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
    const resolved = await this.resolveModule(modulePath);
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
  async checkCircularDependencies(modulePath: string): Promise<string[] | null> {
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
  private normalizePath(modulePath: string): string {
    // If it's an absolute path, return as-is
    if (modulePath.startsWith("/")) {
      return modulePath;
    }
    
    // Resolve relative paths
    return this.context.fileSystem.resolve(this.context.baseDir, modulePath);
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

      // Parse the module content
      // Note: This is a simplified parser - in practice, we'd need a full TPEG file parser
      const moduleFile: ModuleFile = {
        type: "ModuleFile",
        filePath,
        imports: [],
        grammars: [],
      };

      // Extract imports from the content
      const imports = this.parseImports(content);
      moduleFile.imports = imports;

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

    for (const importStmt of moduleFile.imports) {
      dependencies.push(this.normalizePath(importStmt.modulePath));
    }

    return dependencies;
  }

  /**
   * Parse import statements from module content
   */
  private parseImports(content: string): ImportStatement[] {
    const imports: ImportStatement[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ')) {
        try {
          const result = importStatement(trimmed, { offset: 0, line: 1, column: 1 });
          if (result.success) {
            imports.push(result.val);
          }
        } catch {
          // Ignore parse errors for now
        }
      }
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
    const fs = await import('fs/promises');
    return fs.readFile(path, 'utf-8');
  }

  async exists(path: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  resolve(basePath: string, relativePath: string): string {
    const path = require('path');
    return path.resolve(basePath, relativePath);
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
 * @param qualifiedId - The qualified identifier to resolve
 * @param context - Module resolution context
 * @returns Promise<{module: ResolvedModule, ruleName: string}> Resolved reference
 */
export async function resolveQualifiedIdentifier(
  qualifiedId: QualifiedIdentifier,
  context: ModuleResolutionContext,
): Promise<{ module: ResolvedModule; ruleName: string }> {
  // Find the module that exports the referenced rule
  for (const [, module] of context.cache) {
    if (module.resolved) {
      // Check if this module has the alias that matches the qualified identifier
      for (const importStmt of module.content.imports) {
        if (importStmt.alias === qualifiedId.module) {
          // Resolve the imported module
          const resolver = new ModuleResolver(context.baseDir, context.fileSystem);
          resolver.context = context;
          const importedModule = await resolver.resolveModule(importStmt.modulePath);
          
          return {
            module: importedModule,
            ruleName: qualifiedId.name,
          };
        }
      }
    }
  }

  throw new ModuleResolutionError(
    `Cannot resolve qualified identifier: ${qualifiedId.module}.${qualifiedId.name}`,
    qualifiedId.module,
  );
} 
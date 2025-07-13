/**
 * Types for TPEG self-transpilation system
 */

import type { Expression, GrammarDefinition } from "tpeg-core";

/**
 * Result of self-transpilation process
 */
export interface SelfTranspileResult {
  /** Generated parser code */
  code: string;
  /** Generated parser types */
  types: string;
  /** Performance metrics */
  performance: {
    /** Time taken to generate parser */
    generationTime: number;
    /** Memory usage during generation */
    memoryUsage: number;
    /** Complexity estimation */
    complexity: "low" | "medium" | "high";
  };
  /** Any warnings or errors */
  warnings: string[];
  /** Whether the self-transpilation was successful */
  success: boolean;
}

/**
 * Configuration for self-transpilation
 */
export interface SelfTranspileConfig {
  /** Target language for generated parser */
  targetLanguage: "typescript" | "javascript";
  /** Whether to include type definitions */
  includeTypes: boolean;
  /** Whether to optimize the generated code */
  optimize: boolean;
  /** Custom name prefix for generated functions */
  namePrefix?: string;
  /** Whether to enable memoization */
  enableMemoization: boolean;
  /** Whether to include performance monitoring */
  includeMonitoring: boolean;
}

/**
 * Bootstrap configuration for self-hosting
 */
export interface BootstrapConfig {
  /** Initial grammar definition to bootstrap from */
  initialGrammar: GrammarDefinition;
  /** Whether to validate the bootstrap process */
  validate: boolean;
  /** Maximum bootstrap iterations */
  maxIterations: number;
  /** Whether to generate test cases */
  generateTests: boolean;
}

/**
 * Self-transpilation context
 */
export interface SelfTranspileContext {
  /** Current grammar being processed */
  grammar: GrammarDefinition;
  /** Generated parser functions */
  generatedFunctions: Map<string, string>;
  /** Generated type definitions */
  generatedTypes: Map<string, string>;
  /** Performance metrics */
  metrics: {
    startTime: number;
    endTime?: number;
    memoryUsage: number;
    iterations: number;
  };
}

/**
 * Bootstrap result
 */
export interface BootstrapResult {
  /** Final generated parser code */
  parserCode: string;
  /** Generated type definitions */
  typeDefinitions: string;
  /** Bootstrap validation results */
  validation: {
    /** Whether bootstrap was successful */
    success: boolean;
    /** Any validation errors */
    errors: string[];
    /** Performance metrics */
    performance: {
      totalTime: number;
      iterations: number;
      memoryUsage: number;
    };
  };
  /** Generated test cases */
  tests?: string;
}

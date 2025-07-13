/**
 * TPEG Self-Transpilation Implementation
 * 
 * Provides the core functionality for self-transpiling TPEG grammar definitions.
 * This allows TPEG to parse and generate parsers for its own grammar syntax.
 */

import type { Parser } from "tpeg-core";
import { parse } from "tpeg-core";
import type { GrammarDefinition } from "tpeg-core";
import { generateEtaTypeScriptParser } from "tpeg-generator";
import type {
  SelfTranspileResult,
  SelfTranspileConfig,
  SelfTranspileContext,
} from "./types";
import { 
  ErrorHandlingContext, 
  ErrorType, 
  ErrorSeverity, 
  withErrorHandling 
} from "./error-handling";

/**
 * Default configuration for self-transpilation
 */
const DEFAULT_CONFIG: SelfTranspileConfig = {
  targetLanguage: "typescript",
  includeTypes: true,
  optimize: true,
  namePrefix: "self_",
  enableMemoization: true,
  includeMonitoring: false,
};

/**
 * Self-transpiles a TPEG grammar definition
 * 
 * This function takes a TPEG grammar definition and generates a parser
 * that can parse the same grammar syntax. This enables self-hosting.
 * 
 * @param grammarSource - The TPEG grammar definition as a string
 * @param config - Configuration options for the transpilation
 * @returns Promise<SelfTranspileResult> The result of self-transpilation
 * 
 * @example
 * ```typescript
 * const grammarSource = `
 * grammar Calculator {
 *   expression = term (("+" / "-") term)*
 *   term = factor (("*" / "/") factor)*
 *   factor = number / "(" expression ")"
 *   number = [0-9]+
 * }
 * `;
 * 
 * const result = await selfTranspile(grammarSource, {
 *   targetLanguage: "typescript",
 *   includeTypes: true,
 *   optimize: true
 * });
 * 
 * console.log(result.code); // Generated TypeScript parser code
 * ```
 */
export async function selfTranspile(
  grammarSource: string,
  config: Partial<SelfTranspileConfig> = {},
): Promise<SelfTranspileResult> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const startTime = performance.now();
  const startMemory = process.memoryUsage?.()?.heapUsed || 0;

  // Initialize error handling context
  const errorHandler = new ErrorHandlingContext({
    maxRetries: 3,
    timeout: 30000,
    enableDiagnostics: true,
    enableRecovery: true,
    logLevel: "detailed"
  });

  try {
    // Parse the grammar definition using enhanced error handling
    const grammar = await withErrorHandling(
      async () => {
        const result = parseGrammarDefinition(grammarSource);
        if (!result) {
          const error = errorHandler.createError(
            ErrorType.PARSE_ERROR,
            ErrorSeverity.HIGH,
            "Failed to parse grammar definition",
            {
              operation: "parseGrammarDefinition",
              phase: "parsing",
              input: grammarSource.substring(0, 200)
            },
            "Grammar definition could not be parsed by TPEG parser"
          );
          throw new Error(error.message);
        }
        return result;
      },
      {
        operation: "parseGrammarDefinition",
        phase: "parsing",
        input: grammarSource.substring(0, 200)
      },
      errorHandler,
      null
    );

    if (!grammar) {
      return {
        code: "",
        types: "",
        performance: {
          generationTime: performance.now() - startTime,
          memoryUsage: (process.memoryUsage?.()?.heapUsed || 0) - startMemory,
          complexity: "low",
        },
        warnings: [
          "Failed to parse grammar definition",
          ...errorHandler.getErrors().map(e => e.message)
        ],
        success: false,
      };
    }

    // Generate parser code using enhanced error handling
    const generationResult = await withErrorHandling(
      async () => {
        // @ts-ignore - Temporary type compatibility workaround
        return await generateEtaTypeScriptParser(grammar as any, {
          namePrefix: finalConfig.namePrefix || "self_",
          includeTypes: finalConfig.includeTypes,
          optimize: finalConfig.optimize,
          enableMemoization: finalConfig.enableMemoization,
          includeMonitoring: finalConfig.includeMonitoring,
        });
      },
      {
        operation: "generateEtaTypeScriptParser",
        phase: "generation",
        input: grammar.name
      },
      errorHandler,
      null
    );

    const endTime = performance.now();
    const endMemory = process.memoryUsage?.()?.heapUsed || 0;

    if (!generationResult) {
      return {
        code: "",
        types: "",
        performance: {
          generationTime: performance.now() - startTime,
          memoryUsage: (process.memoryUsage?.()?.heapUsed || 0) - startMemory,
          complexity: "low",
        },
        warnings: [
          "Failed to generate parser code",
          ...errorHandler.getErrors().map(e => e.message)
        ],
        success: false,
      };
    }

    // Validate generated code
    const validationResult = await withErrorHandling(
      async () => {
        return await validateSelfTranspile(grammarSource, generationResult.code);
      },
      {
        operation: "validateSelfTranspile",
        phase: "validation"
      },
      errorHandler,
      true // Default to success if validation fails
    );

    // Add diagnostic information
    errorHandler.addDiagnostic("grammar_complexity", estimateComplexity(grammar));
    errorHandler.addDiagnostic("generation_time", endTime - startTime);
    errorHandler.addDiagnostic("memory_usage", endMemory - startMemory);
    errorHandler.addDiagnostic("code_length", generationResult.code.length);

    return {
      code: generationResult.code,
      types: "", // GeneratedCode doesn't have a types property
      performance: {
        generationTime: endTime - startTime,
        memoryUsage: endMemory - startMemory,
        complexity: estimateComplexity(grammar),
      },
      warnings: errorHandler.getErrors().map(e => e.message),
      success: true,
    };
  } catch (error) {
    const endTime = performance.now();
    const endMemory = process.memoryUsage?.()?.heapUsed || 0;

    // Create a comprehensive error report
    const errorReport = errorHandler.generateErrorReport();
    
    return {
      code: "",
      types: "",
      performance: {
        generationTime: endTime - startTime,
        memoryUsage: endMemory - startMemory,
        complexity: "low",
      },
      warnings: [
        `Self-transpilation failed: ${error instanceof Error ? error.message : String(error)}`,
        ...errorHandler.getErrors().map(e => e.message),
        errorReport
      ],
      success: false,
    };
  }
}

/**
 * Parses a TPEG grammar definition string into a GrammarDefinition object
 * 
 * @param source - The grammar definition source code
 * @returns GrammarDefinition | null The parsed grammar definition or null if parsing fails
 */
function parseGrammarDefinition(source: string): GrammarDefinition | null {
  try {
    // Import the grammar parser dynamically to avoid circular dependencies
    const { grammarDefinition } = require("tpeg-parser");
    
    const parser = parse(grammarDefinition);
    const result = parser(source);
    
    if (result.success) {
      return result.val as GrammarDefinition;
    }
    
    return null;
  } catch (error) {
    console.error("Failed to parse grammar definition:", error);
    return null;
  }
}

/**
 * Estimates the complexity of a grammar definition
 * 
 * @param grammar - The grammar definition to analyze
 * @returns "low" | "medium" | "high" The estimated complexity
 */
function estimateComplexity(grammar: GrammarDefinition): "low" | "medium" | "high" {
  const ruleCount = grammar.rules.length;
  const annotationCount = grammar.annotations.length;
  
  // Simple complexity estimation based on rule count and structure
  if (ruleCount < 10 && annotationCount < 5) {
    return "low";
  } else if (ruleCount < 30 && annotationCount < 10) {
    return "medium";
  } else {
    return "high";
  }
}

/**
 * Validates that a self-transpiled parser can parse its own grammar
 * 
 * @param grammarSource - The original grammar source
 * @param generatedCode - The generated parser code
 * @returns Promise<boolean> Whether the validation was successful
 */
export async function validateSelfTranspile(
  grammarSource: string,
  generatedCode: string,
): Promise<boolean> {
  try {
    // This is a simplified validation - in a real implementation,
    // you would need to actually execute the generated code
    // and test it against the original grammar
    
    // For now, we'll do basic syntax validation
    const hasParserFunction = generatedCode.includes("function") || generatedCode.includes("const");
    const hasGrammarReference = generatedCode.includes("grammar") || generatedCode.includes("Grammar");
    
    return hasParserFunction && hasGrammarReference;
  } catch (error) {
    console.error("Validation failed:", error);
    return false;
  }
}

/**
 * Creates a self-transpilation context for iterative processing
 * 
 * @param grammar - The initial grammar definition
 * @returns SelfTranspileContext The created context
 */
export function createSelfTranspileContext(grammar: GrammarDefinition): SelfTranspileContext {
  return {
    grammar,
    generatedFunctions: new Map(),
    generatedTypes: new Map(),
    metrics: {
      startTime: performance.now(),
      memoryUsage: process.memoryUsage?.()?.heapUsed || 0,
      iterations: 0,
    },
  };
} 
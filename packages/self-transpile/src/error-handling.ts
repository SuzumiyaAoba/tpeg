/**
 * TPEG Self-Transpilation Error Handling System
 * 
 * Provides comprehensive error handling, recovery mechanisms, and diagnostic capabilities
 * for the TPEG self-transpilation system.
 */

import type { GrammarDefinition } from "tpeg-core";
import { performance } from "perf_hooks";

/**
 * Error classification system for TPEG self-transpilation
 */
export enum ErrorType {
  PARSE_ERROR = "PARSE_ERROR",
  GENERATION_ERROR = "GENERATION_ERROR", 
  VALIDATION_ERROR = "VALIDATION_ERROR",
  RUNTIME_ERROR = "RUNTIME_ERROR",
  MEMORY_ERROR = "MEMORY_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  SYNTAX_ERROR = "SYNTAX_ERROR",
  SEMANTIC_ERROR = "SEMANTIC_ERROR",
  SYSTEM_ERROR = "SYSTEM_ERROR"
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = "LOW",
  MEDIUM = "MEDIUM", 
  HIGH = "HIGH",
  CRITICAL = "CRITICAL"
}

/**
 * Recovery strategy types
 */
export enum RecoveryStrategy {
  RETRY = "RETRY",
  FALLBACK = "FALLBACK",
  ROLLBACK = "ROLLBACK",
  PARTIAL = "PARTIAL",
  ABORT = "ABORT"
}

/**
 * Detailed error information
 */
export interface TPEGError {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  details: string;
  location?: {
    line: number;
    column: number;
    source?: string;
  };
  timestamp: number;
  context: {
    operation: string;
    phase: string;
    input?: string;
    stack?: string;
  };
  suggestions: string[];
  recoverable: boolean;
}

/**
 * Recovery attempt result
 */
export interface RecoveryResult {
  success: boolean;
  strategy: RecoveryStrategy;
  attemptCount: number;
  timeTaken: number;
  message: string;
  warnings: string[];
  data?: any;
}

/**
 * Error handling configuration
 */
export interface ErrorHandlingConfig {
  maxRetries: number;
  timeout: number;
  enableDiagnostics: boolean;
  enableRecovery: boolean;
  logLevel: "minimal" | "detailed" | "verbose";
  recoveryStrategies: RecoveryStrategy[];
}

/**
 * Default error handling configuration
 */
const DEFAULT_ERROR_CONFIG: ErrorHandlingConfig = {
  maxRetries: 3,
  timeout: 30000, // 30 seconds
  enableDiagnostics: true,
  enableRecovery: true,
  logLevel: "detailed",
  recoveryStrategies: [
    RecoveryStrategy.RETRY,
    RecoveryStrategy.FALLBACK,
    RecoveryStrategy.PARTIAL
  ]
};

/**
 * Error handling context
 */
export class ErrorHandlingContext {
  private errors: TPEGError[] = [];
  private recoveryAttempts: Map<string, number> = new Map();
  private config: ErrorHandlingConfig;
  private diagnostics: Map<string, any> = new Map();

  constructor(config: Partial<ErrorHandlingConfig> = {}) {
    this.config = { ...DEFAULT_ERROR_CONFIG, ...config };
  }

  /**
   * Creates a new TPEG error
   */
  createError(
    type: ErrorType,
    severity: ErrorSeverity,
    message: string,
    context: {
      operation: string;
      phase: string;
      input?: string;
      stack?: string;
    },
    details: string = "",
    location?: { line: number; column: number; source?: string }
  ): TPEGError {
    return {
      type,
      severity,
      message,
      details,
      ...(location && { location }),
      timestamp: Date.now(),
      context,
      suggestions: this.generateSuggestions(type, message, context),
      recoverable: this.isRecoverable(type, severity)
    };
  }

  /**
   * Adds an error to the context
   */
  addError(error: TPEGError): void {
    this.errors.push(error);
    this.logError(error);
  }

  /**
   * Generates helpful suggestions for error recovery
   */
  private generateSuggestions(
    type: ErrorType,
    message: string,
    context: { operation: string; phase: string; input?: string }
  ): string[] {
    const suggestions: string[] = [];

    switch (type) {
      case ErrorType.PARSE_ERROR:
        suggestions.push("Check grammar syntax for missing quotes or brackets");
        suggestions.push("Verify rule definitions are properly formatted");
        suggestions.push("Ensure all rule names are valid identifiers");
        if (context.input) {
          suggestions.push("Try simplifying the grammar temporarily");
        }
        break;

      case ErrorType.GENERATION_ERROR:
        suggestions.push("Check if all rules are properly defined");
        suggestions.push("Verify TypeScript generator compatibility");
        suggestions.push("Try disabling optimization temporarily");
        break;

      case ErrorType.VALIDATION_ERROR:
        suggestions.push("Check generated code syntax");
        suggestions.push("Verify all required exports are present");
        suggestions.push("Test with a simpler grammar first");
        break;

      case ErrorType.RUNTIME_ERROR:
        suggestions.push("Check for circular dependencies");
        suggestions.push("Verify memory usage is within limits");
        suggestions.push("Try reducing grammar complexity");
        break;

      case ErrorType.MEMORY_ERROR:
        suggestions.push("Reduce grammar complexity");
        suggestions.push("Disable memoization temporarily");
        suggestions.push("Process grammar in smaller chunks");
        break;

      case ErrorType.TIMEOUT_ERROR:
        suggestions.push("Simplify grammar to reduce processing time");
        suggestions.push("Increase timeout limit");
        suggestions.push("Check for infinite loops in grammar");
        break;

      default:
        suggestions.push("Review error details and try again");
        suggestions.push("Check system resources and permissions");
        break;
    }

    return suggestions;
  }

  /**
   * Determines if an error is recoverable
   */
  private isRecoverable(type: ErrorType, severity: ErrorSeverity): boolean {
    if (severity === ErrorSeverity.CRITICAL) {
      return false;
    }

    const recoverableTypes = [
      ErrorType.PARSE_ERROR,
      ErrorType.GENERATION_ERROR,
      ErrorType.VALIDATION_ERROR,
      ErrorType.TIMEOUT_ERROR
    ];

    return recoverableTypes.includes(type);
  }

  /**
   * Logs an error with appropriate detail level
   */
  private logError(error: TPEGError): void {
    const timestamp = new Date(error.timestamp).toISOString();
    const prefix = `[${timestamp}] ${error.severity} ${error.type}`;

    switch (this.config.logLevel) {
      case "minimal":
        console.error(`${prefix}: ${error.message}`);
        break;

      case "detailed":
        console.error(`${prefix}: ${error.message}`);
        console.error(`  Operation: ${error.context.operation}`);
        console.error(`  Phase: ${error.context.phase}`);
        if (error.location) {
          console.error(`  Location: Line ${error.location.line}, Column ${error.location.column}`);
        }
        if (error.suggestions.length > 0) {
          console.error(`  Suggestions: ${error.suggestions.join(", ")}`);
        }
        break;

      case "verbose":
        console.error(`${prefix}: ${error.message}`);
        console.error(`  Details: ${error.details}`);
        console.error(`  Operation: ${error.context.operation}`);
        console.error(`  Phase: ${error.context.phase}`);
        if (error.location) {
          console.error(`  Location: Line ${error.location.line}, Column ${error.location.column}`);
          if (error.location.source) {
            console.error(`  Source: ${error.location.source}`);
          }
        }
        if (error.context.input) {
          console.error(`  Input: ${error.context.input.substring(0, 200)}...`);
        }
        if (error.context.stack) {
          console.error(`  Stack: ${error.context.stack}`);
        }
        console.error(`  Suggestions:`);
        error.suggestions.forEach((suggestion, i) => {
          console.error(`    ${i + 1}. ${suggestion}`);
        });
        break;
    }
  }

  /**
   * Attempts to recover from an error
   */
  async attemptRecovery(
    error: TPEGError,
    recoveryFunction: () => Promise<any>,
    fallbackData?: any
  ): Promise<RecoveryResult> {
    if (!this.config.enableRecovery || !error.recoverable) {
      return {
        success: false,
        strategy: RecoveryStrategy.ABORT,
        attemptCount: 0,
        timeTaken: 0,
        message: "Recovery not enabled or error not recoverable",
        warnings: []
      };
    }

    const startTime = performance.now();
    const errorKey = `${error.type}_${error.context.operation}`;
    const currentAttempts = this.recoveryAttempts.get(errorKey) || 0;

    // Try each recovery strategy
    for (const strategy of this.config.recoveryStrategies) {
      const attemptResult = await this.executeRecoveryStrategy(
        strategy,
        error,
        recoveryFunction,
        fallbackData,
        currentAttempts
      );

      if (attemptResult.success) {
        this.recoveryAttempts.set(errorKey, currentAttempts + 1);
        return {
          ...attemptResult,
          timeTaken: performance.now() - startTime
        };
      }
    }

    // All recovery strategies failed
    this.recoveryAttempts.set(errorKey, currentAttempts + 1);
    return {
      success: false,
      strategy: RecoveryStrategy.ABORT,
      attemptCount: currentAttempts + 1,
      timeTaken: performance.now() - startTime,
      message: "All recovery strategies failed",
      warnings: ["Consider manual intervention"]
    };
  }

  /**
   * Executes a specific recovery strategy
   */
  private async executeRecoveryStrategy(
    strategy: RecoveryStrategy,
    error: TPEGError,
    recoveryFunction: () => Promise<any>,
    fallbackData: any,
    currentAttempts: number
  ): Promise<RecoveryResult> {
    console.log(`🔄 Attempting ${strategy} recovery for ${error.type}...`);

    switch (strategy) {
      case RecoveryStrategy.RETRY:
        if (currentAttempts >= this.config.maxRetries) {
          return {
            success: false,
            strategy,
            attemptCount: currentAttempts,
            timeTaken: 0,
            message: "Maximum retry attempts exceeded",
            warnings: []
          };
        }

        try {
          // Add small delay before retry to allow system to recover
          await new Promise(resolve => setTimeout(resolve, 100 * (currentAttempts + 1)));
          
          const result = await Promise.race([
            recoveryFunction(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Recovery timeout")), this.config.timeout)
            )
          ]);

          console.log(`✅ ${strategy} recovery successful`);
          return {
            success: true,
            strategy,
            attemptCount: currentAttempts + 1,
            timeTaken: 0,
            message: "Retry successful",
            warnings: [],
            data: result
          };
        } catch (retryError) {
          console.log(`❌ ${strategy} recovery failed: ${retryError}`);
          // Return failure for this strategy
          return {
            success: false,
            strategy,
            attemptCount: currentAttempts + 1,
            timeTaken: 0,
            message: `Retry failed: ${retryError}`,
            warnings: []
          };
        }

      case RecoveryStrategy.FALLBACK:
        if (fallbackData) {
          console.log(`✅ ${strategy} recovery using fallback data`);
          return {
            success: true,
            strategy,
            attemptCount: currentAttempts + 1,
            timeTaken: 0,
            message: "Using fallback data",
            warnings: ["Result may be incomplete"],
            data: fallbackData
          };
        }
        return {
          success: false,
          strategy,
          attemptCount: currentAttempts + 1,
          timeTaken: 0,
          message: "No fallback data available",
          warnings: []
        };

      case RecoveryStrategy.PARTIAL:
        // Attempt partial recovery based on error type
        if (error.type === ErrorType.PARSE_ERROR) {
          console.log(`✅ ${strategy} recovery with simplified grammar`);
          return {
            success: true,
            strategy,
            attemptCount: currentAttempts + 1,
            timeTaken: 0,
            message: "Partial recovery with simplified grammar",
            warnings: ["Some features may be disabled"],
            data: this.createSimplifiedGrammar(error)
          };
        }
        return {
          success: false,
          strategy,
          attemptCount: currentAttempts + 1,
          timeTaken: 0,
          message: "Partial recovery not supported for this error type",
          warnings: []
        };

      default:
        return {
          success: false,
          strategy,
          attemptCount: currentAttempts + 1,
          timeTaken: 0,
          message: "Unknown recovery strategy",
          warnings: []
        };
    }
  }

  /**
   * Creates a simplified grammar for partial recovery
   */
  private createSimplifiedGrammar(error: TPEGError): any {
    // This is a simplified fallback grammar
    return {
      name: "SimplifiedFallback",
      rules: [
        { name: "grammar", expression: "identifier" },
        { name: "identifier", expression: "[a-zA-Z][a-zA-Z0-9_]*" },
        { name: "string_literal", expression: "\"[^\"]*\"" }
      ],
      annotations: []
    };
  }

  /**
   * Gets diagnostic information
   */
  getDiagnostics(): Map<string, any> {
    return new Map(this.diagnostics);
  }

  /**
   * Adds diagnostic information
   */
  addDiagnostic(key: string, value: any): void {
    this.diagnostics.set(key, value);
  }

  /**
   * Gets all errors
   */
  getErrors(): TPEGError[] {
    return [...this.errors];
  }

  /**
   * Gets errors by type
   */
  getErrorsByType(type: ErrorType): TPEGError[] {
    return this.errors.filter(error => error.type === type);
  }

  /**
   * Gets errors by severity
   */
  getErrorsBySeverity(severity: ErrorSeverity): TPEGError[] {
    return this.errors.filter(error => error.severity === severity);
  }

  /**
   * Clears all errors
   */
  clearErrors(): void {
    this.errors = [];
    this.recoveryAttempts.clear();
    this.diagnostics.clear();
  }

  /**
   * Generates an error report
   */
  generateErrorReport(): string {
    if (this.errors.length === 0) {
      return "No errors recorded.";
    }

    const report = [];
    report.push("TPEG Self-Transpilation Error Report");
    report.push("=====================================");
    report.push(`Total errors: ${this.errors.length}`);
    report.push(`Timestamp: ${new Date().toISOString()}`);
    report.push("");

    // Group errors by type
    const errorsByType = new Map<ErrorType, TPEGError[]>();
    for (const error of this.errors) {
      const existing = errorsByType.get(error.type) || [];
      existing.push(error);
      errorsByType.set(error.type, existing);
    }

    // Report by type
    for (const [type, errors] of errorsByType) {
      report.push(`${type} (${errors.length}):`);
      errors.forEach((error, i) => {
        report.push(`  ${i + 1}. ${error.message}`);
        report.push(`     Operation: ${error.context.operation}`);
        report.push(`     Phase: ${error.context.phase}`);
        report.push(`     Severity: ${error.severity}`);
        if (error.location) {
          report.push(`     Location: Line ${error.location.line}, Column ${error.location.column}`);
        }
        report.push(`     Suggestions: ${error.suggestions.join(", ")}`);
        report.push("");
      });
    }

    return report.join("\n");
  }
}

/**
 * Enhanced error wrapper for TPEG operations
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: {
    operation: string;
    phase: string;
    input?: string;
  },
  errorHandler: ErrorHandlingContext,
  fallbackData?: T
): Promise<T> {
  try {
    const result = await operation();
    return result;
  } catch (error) {
    const tpegError = errorHandler.createError(
      ErrorType.RUNTIME_ERROR,
      ErrorSeverity.MEDIUM,
      error instanceof Error ? error.message : String(error),
      {
        ...context,
        ...(error instanceof Error && error.stack && { stack: error.stack })
      },
      error instanceof Error ? error.stack || "" : String(error)
    );

    errorHandler.addError(tpegError);

    // Attempt recovery
    const recovery = await errorHandler.attemptRecovery(
      tpegError,
      operation,
      fallbackData
    );

    if (recovery.success) {
      console.log(`🎉 Recovery successful with ${recovery.strategy}`);
      return recovery.data;
    }

    // If fallback data is provided, use it instead of throwing
    if (fallbackData !== undefined) {
      console.log(`🔄 Using fallback data due to recovery failure`);
      return fallbackData;
    }

    // Re-throw if recovery failed and no fallback
    throw error;
  }
} 
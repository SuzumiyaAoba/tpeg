import type { ParseError, ParseResult, Pos } from "./types";

/**
 * Error severity levels for better error categorization and handling.
 */
export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Error categories for better error classification and recovery strategies.
 */
export enum ErrorCategory {
  SYNTAX = "syntax",
  SEMANTIC = "semantic",
  RESOURCE = "resource",
  SYSTEM = "system",
}

/**
 * Enhanced error information with additional context and metadata.
 */
export interface EnhancedParseError extends ParseError {
  /** Error severity level */
  severity: ErrorSeverity;
  /** Error category for classification */
  category: ErrorCategory;
  /** Suggested recovery actions */
  suggestions?: string[];
  /** Additional context information */
  context?: Record<string, unknown>;
  /** Error code for programmatic handling */
  code?: string;
  /** Whether this error is recoverable */
  recoverable: boolean;
}

/**
 * Error recovery strategy types.
 */
export enum RecoveryStrategy {
  RETRY = "retry",
  SKIP = "skip",
  REPLACE = "replace",
  IGNORE = "ignore",
  ABORT = "abort",
}

/**
 * Error recovery result.
 */
export interface RecoveryResult {
  /** Whether recovery was successful */
  success: boolean;
  /** The strategy used for recovery */
  strategy: RecoveryStrategy;
  /** Recovered value or fallback */
  value?: unknown;
  /** Additional information about the recovery */
  message?: string;
  /** Warnings about the recovery */
  warnings?: string[];
}

/**
 * Error handling configuration.
 */
export interface ErrorHandlingConfig {
  /** Maximum number of recovery attempts */
  maxRecoveryAttempts: number;
  /** Whether to enable automatic recovery */
  enableRecovery: boolean;
  /** Default recovery strategy */
  defaultStrategy: RecoveryStrategy;
  /** Whether to log recovery attempts */
  logRecovery: boolean;
  /** Error severity threshold for recovery */
  recoveryThreshold: ErrorSeverity;
}

/**
 * Default error handling configuration.
 */
export const DEFAULT_ERROR_CONFIG: ErrorHandlingConfig = {
  maxRecoveryAttempts: 3,
  enableRecovery: true,
  defaultStrategy: RecoveryStrategy.SKIP,
  logRecovery: true,
  recoveryThreshold: ErrorSeverity.MEDIUM,
};

/**
 * Enhanced error handler for better error management and recovery.
 */
export class ErrorHandler {
  private config: ErrorHandlingConfig;
  private recoveryAttempts: Map<string, number> = new Map();
  private errorHistory: EnhancedParseError[] = [];

  constructor(config: Partial<ErrorHandlingConfig> = {}) {
    this.config = { ...DEFAULT_ERROR_CONFIG, ...config };
  }

  /**
   * Creates an enhanced parse error with additional context.
   */
  createEnhancedError(
    error: ParseError,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    category: ErrorCategory = ErrorCategory.SYNTAX,
    options: Partial<EnhancedParseError> = {},
  ): EnhancedParseError {
    return {
      ...error,
      severity,
      category,
      recoverable: severity <= this.config.recoveryThreshold,
      suggestions: this.generateSuggestions(error, category),
      ...options,
    };
  }

  /**
   * Attempts to recover from a parse error.
   */
  attemptRecovery(
    error: EnhancedParseError,
    input: string,
    pos: Pos,
    context?: Record<string, unknown>,
  ): RecoveryResult {
    if (!this.config.enableRecovery || !error.recoverable) {
      return {
        success: false,
        strategy: RecoveryStrategy.ABORT,
        message: "Recovery not enabled or error not recoverable",
      };
    }

    const errorKey = `${error.category}_${error.severity}_${pos.offset}`;
    const attempts = this.recoveryAttempts.get(errorKey) || 0;

    if (attempts >= this.config.maxRecoveryAttempts) {
      return {
        success: false,
        strategy: RecoveryStrategy.ABORT,
        message: "Maximum recovery attempts exceeded",
      };
    }

    this.recoveryAttempts.set(errorKey, attempts + 1);
    this.errorHistory.push(error);

    const strategy = this.selectRecoveryStrategy(error, context);
    const result = this.executeRecoveryStrategy(strategy, error, input, pos, context);

    if (this.config.logRecovery) {
      console.log(`Recovery attempt ${attempts + 1}: ${strategy} - ${result.success ? "SUCCESS" : "FAILED"}`);
    }

    return result;
  }

  /**
   * Selects the most appropriate recovery strategy based on error type and context.
   */
  private selectRecoveryStrategy(
    error: EnhancedParseError,
    context?: Record<string, unknown>,
  ): RecoveryStrategy {
    // Use context to determine strategy
    if (context?.suggestedStrategy) {
      return context.suggestedStrategy as RecoveryStrategy;
    }

    // Default strategy selection based on error category
    switch (error.category) {
      case ErrorCategory.SYNTAX:
        return RecoveryStrategy.SKIP;
      case ErrorCategory.SEMANTIC:
        return RecoveryStrategy.REPLACE;
      case ErrorCategory.RESOURCE:
        return RecoveryStrategy.RETRY;
      case ErrorCategory.SYSTEM:
        return RecoveryStrategy.ABORT;
      default:
        return this.config.defaultStrategy;
    }
  }

  /**
   * Executes a specific recovery strategy.
   */
  private executeRecoveryStrategy(
    strategy: RecoveryStrategy,
    error: EnhancedParseError,
    input: string,
    pos: Pos,
    context?: Record<string, unknown>,
  ): RecoveryResult {
    switch (strategy) {
      case RecoveryStrategy.SKIP:
        return this.skipError(error, input, pos);
      case RecoveryStrategy.REPLACE:
        return this.replaceError(error, input, pos, context);
      case RecoveryStrategy.RETRY:
        return this.retryError(error, input, pos);
      case RecoveryStrategy.IGNORE:
        return this.ignoreError(error);
      default:
        return {
          success: false,
          strategy: RecoveryStrategy.ABORT,
          message: "Recovery aborted",
        };
    }
  }

  /**
   * Skips the problematic input and continues parsing.
   */
  private skipError(
    error: EnhancedParseError,
    input: string,
    pos: Pos,
  ): RecoveryResult {
    // Find the next safe position to continue parsing
    const nextPos = this.findNextSafePosition(input, pos);
    
    return {
      success: true,
      strategy: RecoveryStrategy.SKIP,
      value: { nextPosition: nextPos },
      message: "Skipped problematic input",
      warnings: ["Some input was skipped during recovery"],
    };
  }

  /**
   * Replaces the error with a fallback value.
   */
  private replaceError(
    error: EnhancedParseError,
    input: string,
    pos: Pos,
    context?: Record<string, unknown>,
  ): RecoveryResult {
    const fallback = this.generateFallbackValue(error, context);
    
    return {
      success: true,
      strategy: RecoveryStrategy.REPLACE,
      value: fallback,
      message: "Replaced with fallback value",
      warnings: ["Original value was replaced during recovery"],
    };
  }

  /**
   * Retries the parsing operation.
   */
  private retryError(
    error: EnhancedParseError,
    input: string,
    pos: Pos,
  ): RecoveryResult {
    // For retry, we return success but indicate that retry should be attempted
    return {
      success: true,
      strategy: RecoveryStrategy.RETRY,
      message: "Retry recommended",
      warnings: ["Consider retrying the operation"],
    };
  }

  /**
   * Ignores the error and continues.
   */
  private ignoreError(error: EnhancedParseError): RecoveryResult {
    return {
      success: true,
      strategy: RecoveryStrategy.IGNORE,
      message: "Error ignored",
      warnings: ["Error was ignored during recovery"],
    };
  }

  /**
   * Finds the next safe position to continue parsing after an error.
   */
  private findNextSafePosition(input: string, pos: Pos): Pos {
    let currentPos = { ...pos };
    
    // Skip until we find a safe character (whitespace, newline, or common delimiter)
    while (currentPos.offset < input.length) {
      const char = input[currentPos.offset];
      if (char === " " || char === "\n" || char === "\t" || char === "," || char === ";") {
        break;
      }
      currentPos = { ...currentPos, offset: currentPos.offset + 1, column: currentPos.column + 1 };
    }
    
    return currentPos;
  }

  /**
   * Generates a fallback value based on error context.
   */
  private generateFallbackValue(
    error: EnhancedParseError,
    context?: Record<string, unknown>,
  ): unknown {
    // Generate appropriate fallback based on expected type
    if (error.expected) {
      if (typeof error.expected === "string") {
        if (error.expected.includes("number")) return 0;
        if (error.expected.includes("string")) return "";
        if (error.expected.includes("array")) return [];
        if (error.expected.includes("object")) return {};
      }
    }
    
    // Default fallback
    return null;
  }

  /**
   * Generates helpful suggestions for error recovery.
   */
  private generateSuggestions(error: ParseError, category: ErrorCategory): string[] {
    const suggestions: string[] = [];
    
    switch (category) {
      case ErrorCategory.SYNTAX:
        if (error.expected) {
          suggestions.push(`Expected: ${Array.isArray(error.expected) ? error.expected.join(" or ") : error.expected}`);
        }
        if (error.found) {
          suggestions.push(`Found: ${error.found}`);
        }
        suggestions.push("Check syntax and ensure proper formatting");
        break;
      
      case ErrorCategory.SEMANTIC:
        suggestions.push("Verify the input matches the expected format");
        suggestions.push("Check for missing or extra characters");
        break;
      
      case ErrorCategory.RESOURCE:
        suggestions.push("Try again with a smaller input");
        suggestions.push("Check available memory and system resources");
        break;
      
      case ErrorCategory.SYSTEM:
        suggestions.push("Restart the application");
        suggestions.push("Check system resources and permissions");
        break;
    }
    
    return suggestions;
  }

  /**
   * Gets error statistics and history.
   */
  getErrorStats(): {
    totalErrors: number;
    errorsByCategory: Record<ErrorCategory, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
    recoverySuccessRate: number;
  } {
    const errorsByCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.SYNTAX]: 0,
      [ErrorCategory.SEMANTIC]: 0,
      [ErrorCategory.RESOURCE]: 0,
      [ErrorCategory.SYSTEM]: 0,
    };

    const errorsBySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.LOW]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.HIGH]: 0,
      [ErrorSeverity.CRITICAL]: 0,
    };

    let recoveryAttempts = 0;
    let recoverySuccesses = 0;

    for (const error of this.errorHistory) {
      errorsByCategory[error.category]++;
      errorsBySeverity[error.severity]++;
      
      if (error.recoverable) {
        recoveryAttempts++;
        // This is a simplified calculation - in practice you'd track actual recovery results
        recoverySuccesses++;
      }
    }

    return {
      totalErrors: this.errorHistory.length,
      errorsByCategory,
      errorsBySeverity,
      recoverySuccessRate: recoveryAttempts > 0 ? recoverySuccesses / recoveryAttempts : 0,
    };
  }

  /**
   * Clears error history and recovery attempts.
   */
  clearHistory(): void {
    this.errorHistory = [];
    this.recoveryAttempts.clear();
  }

  /**
   * Gets the current configuration.
   */
  getConfig(): ErrorHandlingConfig {
    return { ...this.config };
  }

  /**
   * Updates the error handling configuration.
   */
  updateConfig(newConfig: Partial<ErrorHandlingConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

/**
 * Creates a new error handler with the specified configuration.
 */
export function createErrorHandler(config?: Partial<ErrorHandlingConfig>): ErrorHandler {
  return new ErrorHandler(config);
}

/**
 * Wraps a parser with enhanced error handling.
 */
export function withErrorHandling<T>(
  parser: (input: string, pos: Pos) => ParseResult<T>,
  errorHandler: ErrorHandler,
  severity: ErrorSeverity = ErrorSeverity.MEDIUM,
  category: ErrorCategory = ErrorCategory.SYNTAX,
): (input: string, pos: Pos) => ParseResult<T> {
  return (input: string, pos: Pos) => {
    const result = parser(input, pos);
    
    if (!result.success) {
      const enhancedError = errorHandler.createEnhancedError(
        result.error,
        severity,
        category,
      );
      
      const recovery = errorHandler.attemptRecovery(enhancedError, input, pos);
      
      if (recovery.success && recovery.value) {
        // Return a modified result with the recovered value
        return {
          success: true,
          val: recovery.value as T,
          current: pos,
          next: pos, // Recovery typically doesn't advance position
        };
      }
    }
    
    return result;
  };
} 
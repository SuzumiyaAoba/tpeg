import { describe, expect, it } from "bun:test";
import {
  createErrorHandler,
  ErrorCategory,
  ErrorSeverity,
  RecoveryStrategy,
  withErrorHandling,
} from "./error-handling";
import { literal } from "./basic";

describe("Error Handling", () => {
  describe("ErrorHandler", () => {
    it("should create an error handler with default configuration", () => {
      const handler = createErrorHandler();
      const config = handler.getConfig();
      
      expect(config.maxRecoveryAttempts).toBe(3);
      expect(config.enableRecovery).toBe(true);
      expect(config.defaultStrategy).toBe(RecoveryStrategy.SKIP);
    });

    it("should create an error handler with custom configuration", () => {
      const handler = createErrorHandler({
        maxRecoveryAttempts: 5,
        enableRecovery: false,
        defaultStrategy: RecoveryStrategy.ABORT,
      });
      const config = handler.getConfig();
      
      expect(config.maxRecoveryAttempts).toBe(5);
      expect(config.enableRecovery).toBe(false);
      expect(config.defaultStrategy).toBe(RecoveryStrategy.ABORT);
    });

    it("should create enhanced errors with proper metadata", () => {
      const handler = createErrorHandler();
      const baseError = {
        message: "Test error",
        pos: { offset: 0, column: 0, line: 1 },
        expected: "string",
        found: "number",
      };
      
      const enhancedError = handler.createEnhancedError(
        baseError,
        ErrorSeverity.HIGH,
        ErrorCategory.SYNTAX,
        { code: "TEST_ERROR" },
      );
      
      expect(enhancedError.severity).toBe(ErrorSeverity.HIGH);
      expect(enhancedError.category).toBe(ErrorCategory.SYNTAX);
      expect(enhancedError.code).toBe("TEST_ERROR");
      expect(enhancedError.recoverable).toBe(true);
      expect(enhancedError.suggestions).toBeDefined();
    });

    it("should attempt recovery for recoverable errors", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Test error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.LOW,
        ErrorCategory.SYNTAX,
      );
      
      const recovery = handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 });
      
      expect(recovery.success).toBe(true);
      expect(recovery.strategy).toBe(RecoveryStrategy.SKIP);
    });

    it("should not attempt recovery for non-recoverable errors", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Critical error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.CRITICAL,
        ErrorCategory.SYSTEM,
      );
      
      const recovery = handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 });
      
      expect(recovery.success).toBe(false);
      expect(recovery.strategy).toBe(RecoveryStrategy.ABORT);
    });

    it("should respect maximum recovery attempts", () => {
      const handler = createErrorHandler({ maxRecoveryAttempts: 1 });
      const enhancedError = handler.createEnhancedError(
        {
          message: "Test error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.LOW,
        ErrorCategory.SYNTAX,
      );
      
      // First attempt should succeed
      const recovery1 = handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 });
      expect(recovery1.success).toBe(true);
      
      // Second attempt should fail due to max attempts
      const recovery2 = handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 });
      expect(recovery2.success).toBe(false);
      expect(recovery2.message).toContain("Maximum recovery attempts exceeded");
    });

    it("should track error statistics correctly", () => {
      const handler = createErrorHandler();
      
      // Create and attempt recovery for various errors
      const errors = [
        { severity: ErrorSeverity.LOW, category: ErrorCategory.SYNTAX },
        { severity: ErrorSeverity.MEDIUM, category: ErrorCategory.SEMANTIC },
        { severity: ErrorSeverity.HIGH, category: ErrorCategory.RESOURCE },
        { severity: ErrorSeverity.CRITICAL, category: ErrorCategory.SYSTEM },
      ];
      
      for (const errorInfo of errors) {
        const enhancedError = handler.createEnhancedError(
          {
            message: "Test error",
            pos: { offset: 0, column: 0, line: 1 },
          },
          errorInfo.severity,
          errorInfo.category,
        );
        
        handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 });
      }
      
      const stats = handler.getErrorStats();
      
      expect(stats.totalErrors).toBe(4);
      expect(stats.errorsByCategory[ErrorCategory.SYNTAX]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.SEMANTIC]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.RESOURCE]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.SYSTEM]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.LOW]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.MEDIUM]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.HIGH]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.CRITICAL]).toBe(1);
    });

    it("should clear error history", () => {
      const handler = createErrorHandler();
      
      const enhancedError = handler.createEnhancedError(
        {
          message: "Test error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.LOW,
        ErrorCategory.SYNTAX,
      );
      
      handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 });
      
      expect(handler.getErrorStats().totalErrors).toBe(1);
      
      handler.clearHistory();
      
      expect(handler.getErrorStats().totalErrors).toBe(0);
    });

    it("should update configuration", () => {
      const handler = createErrorHandler();
      
      handler.updateConfig({
        maxRecoveryAttempts: 10,
        enableRecovery: false,
      });
      
      const config = handler.getConfig();
      expect(config.maxRecoveryAttempts).toBe(10);
      expect(config.enableRecovery).toBe(false);
    });
  });

  describe("Recovery Strategies", () => {
    it("should skip errors correctly", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Test error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.LOW,
        ErrorCategory.SYNTAX,
      );
      
      const recovery = handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 });
      
      expect(recovery.success).toBe(true);
      expect(recovery.strategy).toBe(RecoveryStrategy.SKIP);
      expect(recovery.value).toBeDefined();
      expect(recovery.warnings).toContain("Some input was skipped during recovery");
    });

    it("should replace errors with fallback values", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Test error",
          pos: { offset: 0, column: 0, line: 1 },
          expected: "number",
        },
        ErrorSeverity.MEDIUM,
        ErrorCategory.SEMANTIC,
      );
      
      const recovery = handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 });
      
      expect(recovery.success).toBe(true);
      expect(recovery.strategy).toBe(RecoveryStrategy.REPLACE);
      expect(recovery.value).toBe(0); // Fallback for number
      expect(recovery.warnings).toContain("Original value was replaced during recovery");
    });

    it("should ignore errors when configured", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Test error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.LOW,
        ErrorCategory.SYNTAX,
      );
      
      // Mock context to suggest ignore strategy
      const context = { suggestedStrategy: RecoveryStrategy.IGNORE };
      const recovery = handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 }, context);
      
      expect(recovery.success).toBe(true);
      expect(recovery.strategy).toBe(RecoveryStrategy.IGNORE);
      expect(recovery.warnings).toContain("Error was ignored during recovery");
    });
  });

  describe("withErrorHandling", () => {
    it("should wrap a parser with error handling", () => {
      const handler = createErrorHandler();
      const parser = literal("hello");
      const wrappedParser = withErrorHandling(parser, handler);
      
      expect(typeof wrappedParser).toBe("function");
    });

    it("should pass through successful results", () => {
      const handler = createErrorHandler();
      const parser = literal("hello");
      const wrappedParser = withErrorHandling(parser, handler);
      
      const result = wrappedParser("hello world", { offset: 0, column: 0, line: 1 });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe("hello");
      }
    });

    it("should attempt recovery for failed results", () => {
      const handler = createErrorHandler();
      const parser = literal("hello");
      const wrappedParser = withErrorHandling(parser, handler, ErrorSeverity.LOW, ErrorCategory.SYNTAX);
      
      const result = wrappedParser("world", { offset: 0, column: 0, line: 1 });
      
      // The parser should fail, but recovery might provide a fallback
      // This test verifies the error handling is invoked
      // Note: Recovery might succeed and return a fallback value
      expect(typeof result).toBe("object");
      expect("success" in result).toBe(true);
    });
  });

  describe("Error Categories and Severity", () => {
    it("should handle syntax errors appropriately", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Syntax error",
          pos: { offset: 0, column: 0, line: 1 },
          expected: "string",
          found: "number",
        },
        ErrorSeverity.MEDIUM,
        ErrorCategory.SYNTAX,
      );
      
      expect(enhancedError.category).toBe(ErrorCategory.SYNTAX);
      expect(enhancedError.suggestions).toContain("Check syntax and ensure proper formatting");
    });

    it("should handle semantic errors appropriately", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Semantic error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.HIGH,
        ErrorCategory.SEMANTIC,
      );
      
      expect(enhancedError.category).toBe(ErrorCategory.SEMANTIC);
      expect(enhancedError.suggestions).toContain("Verify the input matches the expected format");
    });

    it("should handle resource errors appropriately", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Resource error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.HIGH,
        ErrorCategory.RESOURCE,
      );
      
      expect(enhancedError.category).toBe(ErrorCategory.RESOURCE);
      expect(enhancedError.suggestions).toContain("Try again with a smaller input");
    });

    it("should handle system errors appropriately", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "System error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.CRITICAL,
        ErrorCategory.SYSTEM,
      );
      
      expect(enhancedError.category).toBe(ErrorCategory.SYSTEM);
      expect(enhancedError.suggestions).toContain("Restart the application");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty input gracefully", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Empty input",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.LOW,
        ErrorCategory.SYNTAX,
      );
      
      const recovery = handler.attemptRecovery(enhancedError, "", { offset: 0, column: 0, line: 1 });
      
      expect(recovery.success).toBe(true);
    });

    it("should handle null/undefined context gracefully", () => {
      const handler = createErrorHandler();
      const enhancedError = handler.createEnhancedError(
        {
          message: "Test error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.LOW,
        ErrorCategory.SYNTAX,
      );
      
      const recovery = handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 }, undefined);
      
      expect(recovery.success).toBe(true);
    });

    it("should handle disabled recovery", () => {
      const handler = createErrorHandler({ enableRecovery: false });
      const enhancedError = handler.createEnhancedError(
        {
          message: "Test error",
          pos: { offset: 0, column: 0, line: 1 },
        },
        ErrorSeverity.LOW,
        ErrorCategory.SYNTAX,
      );
      
      const recovery = handler.attemptRecovery(enhancedError, "test input", { offset: 0, column: 0, line: 1 });
      
      expect(recovery.success).toBe(false);
      expect(recovery.message).toContain("Recovery not enabled");
    });
  });
}); 
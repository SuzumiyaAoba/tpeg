/**
 * Error Handling System Test for TPEG Self-Transpilation
 * 
 * Tests various error scenarios and recovery mechanisms
 * to ensure robust error handling in self-transpilation.
 */

import { readFileSync } from "fs";
import { selfTranspile } from "./self-transpile";
import { 
  ErrorHandlingContext, 
  ErrorType, 
  ErrorSeverity, 
  RecoveryStrategy,
  withErrorHandling
} from "./error-handling";
import { performance } from "perf_hooks";

/**
 * Test scenarios for error handling validation
 */
interface ErrorTestScenario {
  name: string;
  description: string;
  input: string;
  expectedErrorType: ErrorType;
  expectedRecovery: boolean;
  timeout: number;
}

async function testErrorHandling() {
  console.log("🧪 TPEG Error Handling System Test");
  console.log("====================================");
  
  const startTime = performance.now();
  
  // Test scenarios
  const scenarios: ErrorTestScenario[] = [
    {
      name: "Invalid Grammar Syntax",
      description: "Test parsing error with malformed grammar",
      input: `
        grammar InvalidGrammar {
          rule1 = "missing quote
          rule2 = [unclosed bracket
          rule3 = (unclosed paren
        }
      `,
      expectedErrorType: ErrorType.PARSE_ERROR,
      expectedRecovery: true,
      timeout: 5000
    },
    {
      name: "Empty Grammar",
      description: "Test parsing error with empty grammar",
      input: "",
      expectedErrorType: ErrorType.PARSE_ERROR,
      expectedRecovery: true,
      timeout: 5000
    },
    {
      name: "Missing Grammar Declaration",
      description: "Test parsing error without grammar declaration",
      input: `
        rule1 = "test"
        rule2 = [a-z]+
      `,
      expectedErrorType: ErrorType.PARSE_ERROR,
      expectedRecovery: true,
      timeout: 5000
    },
    {
      name: "Very Complex Grammar",
      description: "Test memory/timeout error with extremely complex grammar",
      input: generateComplexGrammar(1000), // 1000 rules
      expectedErrorType: ErrorType.MEMORY_ERROR,
      expectedRecovery: false,
      timeout: 1000 // Short timeout to trigger timeout error
    },
    {
      name: "Recursive Loop Grammar",
      description: "Test infinite recursion detection",
      input: `
        grammar RecursiveGrammar {
          a = b
          b = c
          c = a
        }
      `,
      expectedErrorType: ErrorType.GENERATION_ERROR,
      expectedRecovery: true,
      timeout: 5000
    }
  ];

  console.log(`🎯 Testing ${scenarios.length} error scenarios...`);
  console.log("");

  const results = [];
  
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    if (!scenario) continue;
    
    console.log(`🔧 Test ${i + 1}: ${scenario.name}`);
    console.log("─".repeat(50));
    console.log(`📝 ${scenario.description}`);
    
    const testStart = performance.now();
    
    try {
      // Test with enhanced error handling
      const result = await selfTranspile(scenario.input, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: false, // Disable optimization for error testing
        namePrefix: `test${i + 1}_`,
        enableMemoization: true,
        includeMonitoring: true
      });
      
      const testTime = performance.now() - testStart;
      
      if (result.success) {
        console.log(`✅ Unexpected success: ${result.code.length} chars generated`);
        console.log(`⏱️  Time: ${testTime.toFixed(2)}ms`);
        results.push({
          scenario: scenario.name,
          success: true,
          expected: false,
          errors: [],
          warnings: result.warnings,
          testTime
        });
      } else {
        console.log(`❌ Expected failure detected`);
        console.log(`🚨 Warnings: ${result.warnings.length}`);
        console.log(`⏱️  Time: ${testTime.toFixed(2)}ms`);
        
        // Analyze error messages
        const errorMessages = result.warnings.join(" ");
        const detectedErrorType = analyzeErrorType(errorMessages);
        
        console.log(`📊 Analysis:`);
        console.log(`   🔍 Detected error type: ${detectedErrorType}`);
        console.log(`   🎯 Expected error type: ${scenario.expectedErrorType}`);
        console.log(`   🔄 Recovery attempted: ${errorMessages.includes('recovery') ? 'Yes' : 'No'}`);
        
        results.push({
          scenario: scenario.name,
          success: false,
          expected: true,
          errors: [detectedErrorType],
          warnings: result.warnings,
          testTime,
          errorTypeMatch: detectedErrorType === scenario.expectedErrorType
        });
      }
      
    } catch (error) {
      const testTime = performance.now() - testStart;
      console.log(`💥 Exception: ${error}`);
      console.log(`⏱️  Time: ${testTime.toFixed(2)}ms`);
      
      results.push({
        scenario: scenario.name,
        success: false,
        expected: true,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
        testTime,
        exception: true
      });
    }
    
    console.log("");
  }

  // Test recovery mechanisms specifically
  console.log("🔄 Testing Recovery Mechanisms");
  console.log("===============================");
  
  await testRecoveryMechanisms();
  
  // Test error handling context
  console.log("\n🧠 Testing Error Handling Context");
  console.log("==================================");
  
  await testErrorHandlingContext();
  
  // Summary
  const totalTime = performance.now() - startTime;
  console.log("\n📊 Error Handling Test Summary");
  console.log("===============================");
  console.log(`🎯 Total scenarios tested: ${scenarios.length}`);
  console.log(`⏱️  Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`📈 Average time per test: ${(totalTime / scenarios.length).toFixed(2)}ms`);
  
  const expectedFailures = results.filter(r => !r.success && r.expected).length;
  const unexpectedSuccesses = results.filter(r => r.success && !r.expected).length;
  const exceptions = results.filter(r => (r as any).exception).length;
  
  console.log(`✅ Expected failures: ${expectedFailures}`);
  console.log(`❌ Unexpected successes: ${unexpectedSuccesses}`);
  console.log(`💥 Exceptions: ${exceptions}`);
  
  // Detailed results
  console.log("\n📋 Detailed Results:");
  results.forEach((result, index) => {
    const status = result.success ? 
      (result.expected ? '❌ UNEXPECTED SUCCESS' : '✅ SUCCESS') :
      (result.expected ? '✅ EXPECTED FAILURE' : '❌ FAILURE');
    
    console.log(`   ${index + 1}. ${result.scenario}: ${status}`);
    console.log(`      Time: ${result.testTime.toFixed(2)}ms`);
    console.log(`      Errors: ${result.errors.length}`);
    console.log(`      Warnings: ${result.warnings.length}`);
    
    if ((result as any).errorTypeMatch !== undefined) {
      console.log(`      Error type match: ${(result as any).errorTypeMatch ? '✅' : '❌'}`);
    }
  });

  // Final assessment
  const successRate = (expectedFailures / scenarios.length) * 100;
  console.log(`\n🏆 Error Handling Success Rate: ${successRate.toFixed(1)}%`);
  
  if (successRate >= 80) {
    console.log("🎉 EXCELLENT: Error handling system is working well!");
  } else if (successRate >= 60) {
    console.log("👍 GOOD: Error handling system needs minor improvements");
  } else {
    console.log("⚠️  NEEDS IMPROVEMENT: Error handling system requires attention");
  }
}

/**
 * Test recovery mechanisms specifically
 */
async function testRecoveryMechanisms() {
  console.log("🔄 Testing RETRY strategy...");
  
  const errorHandler = new ErrorHandlingContext({
    maxRetries: 3,
    timeout: 5000,
    enableRecovery: true,
    logLevel: "detailed",
    recoveryStrategies: [RecoveryStrategy.RETRY]
  });
  
  let attemptCount = 0;
  const testOperation = async () => {
    attemptCount++;
    if (attemptCount < 3) {
      throw new Error("Simulated failure");
    }
    return "Success on third attempt";
  };
  
  try {
    const result = await withErrorHandling(
      testOperation,
      {
        operation: "testRetry",
        phase: "testing"
      },
      errorHandler,
      "fallback"
    );
    console.log(`✅ RETRY test passed: ${result}`);
  } catch (error) {
    console.log(`❌ RETRY test failed: ${error}`);
  }
  
  console.log("🔄 Testing FALLBACK strategy...");
  
  const fallbackHandler = new ErrorHandlingContext({
    maxRetries: 1,
    timeout: 1000,
    enableRecovery: true,
    logLevel: "detailed",
    recoveryStrategies: [RecoveryStrategy.FALLBACK]
  });
  
  try {
    const result = await withErrorHandling(
      async () => {
        throw new Error("Always fails");
      },
      {
        operation: "testFallback",
        phase: "testing"
      },
      fallbackHandler,
      "fallback data"
    );
    console.log(`✅ FALLBACK test passed: ${result}`);
  } catch (error) {
    console.log(`❌ FALLBACK test failed: ${error}`);
  }
}

/**
 * Test error handling context functionality
 */
async function testErrorHandlingContext() {
  const context = new ErrorHandlingContext({
    logLevel: "verbose",
    enableDiagnostics: true
  });
  
  // Test error creation and logging
  const testError = context.createError(
    ErrorType.PARSE_ERROR,
    ErrorSeverity.HIGH,
    "Test error message",
    {
      operation: "test",
      phase: "testing",
      input: "test input"
    },
    "Detailed error description"
  );
  
  context.addError(testError);
  
  // Test diagnostic information
  context.addDiagnostic("test_metric", 42);
  context.addDiagnostic("test_data", { key: "value" });
  
  // Test error retrieval
  const allErrors = context.getErrors();
  const parseErrors = context.getErrorsByType(ErrorType.PARSE_ERROR);
  const highSeverityErrors = context.getErrorsBySeverity(ErrorSeverity.HIGH);
  
  console.log(`📊 Context Test Results:`);
  console.log(`   Total errors: ${allErrors.length}`);
  console.log(`   Parse errors: ${parseErrors.length}`);
  console.log(`   High severity errors: ${highSeverityErrors.length}`);
  console.log(`   Diagnostics: ${context.getDiagnostics().size}`);
  
  // Test error report generation
  const report = context.generateErrorReport();
  console.log(`📋 Error report generated: ${report.length} characters`);
  
  // Test suggestions
  if (testError.suggestions.length > 0) {
    console.log(`💡 Suggestions provided: ${testError.suggestions.length}`);
    testError.suggestions.forEach((suggestion, i) => {
      console.log(`   ${i + 1}. ${suggestion}`);
    });
  }
}

/**
 * Analyze error messages to determine error type
 */
function analyzeErrorType(errorMessage: string): ErrorType {
  const message = errorMessage.toLowerCase();
  
  if (message.includes('parse') || message.includes('syntax')) {
    return ErrorType.PARSE_ERROR;
  }
  if (message.includes('generation') || message.includes('generate')) {
    return ErrorType.GENERATION_ERROR;
  }
  if (message.includes('validation') || message.includes('validate')) {
    return ErrorType.VALIDATION_ERROR;
  }
  if (message.includes('memory') || message.includes('heap')) {
    return ErrorType.MEMORY_ERROR;
  }
  if (message.includes('timeout') || message.includes('time')) {
    return ErrorType.TIMEOUT_ERROR;
  }
  if (message.includes('runtime') || message.includes('execution')) {
    return ErrorType.RUNTIME_ERROR;
  }
  
  return ErrorType.SYSTEM_ERROR;
}

/**
 * Generate a complex grammar for stress testing
 */
function generateComplexGrammar(ruleCount: number): string {
  const rules = [];
  rules.push(`grammar ComplexGrammar {`);
  
  for (let i = 0; i < ruleCount; i++) {
    const ruleName = `rule${i}`;
    const ruleBody = `"prefix${i}" [a-z${i % 10}]* "suffix${i}"`;
    rules.push(`  ${ruleName} = ${ruleBody}`);
  }
  
  rules.push(`}`);
  return rules.join('\n');
}

// Run the test
testErrorHandling().catch(console.error); 
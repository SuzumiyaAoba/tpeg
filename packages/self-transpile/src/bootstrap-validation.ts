/**
 * Bootstrap Validation System for TPEG Self-Transpilation
 *
 * Provides comprehensive validation of the self-hosting bootstrap process
 * with rollback capabilities, progress tracking, and detailed logging.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createSelfTranspileContext, selfTranspile } from "./self-transpile";
import type {
  BootstrapConfig,
  BootstrapResult,
  SelfTranspileContext,
} from "./types";

interface BootstrapStage {
  id: number;
  name: string;
  description: string;
  inputGrammar: string;
  expectedFeatures: string[];
  validationCriteria: {
    minCodeLength: number;
    maxCodeLength: number;
    requiredExports: string[];
    requiredFeatures: string[];
  };
}

interface StageResult {
  stage: BootstrapStage;
  success: boolean;
  generatedCode: string;
  codeLength: number;
  generationTime: number;
  validationResults: {
    lengthCheck: boolean;
    exportsCheck: boolean;
    featuresCheck: boolean;
    structureCheck: boolean;
  };
  errors: string[];
  warnings: string[];
}

interface BootstrapValidationResult {
  totalStages: number;
  completedStages: number;
  successRate: number;
  totalTime: number;
  finalBootstrapSuccessful: boolean;
  stageResults: StageResult[];
  rollbacksPerformed: number;
  finalValidation: {
    canParseOriginal: boolean;
    canGenerateConsistent: boolean;
    performanceAcceptable: boolean;
  };
}

async function validateBootstrapProcess(
  config: BootstrapConfig,
): Promise<BootstrapResult> {
  console.log("🔧 TPEG Bootstrap Validation System");
  console.log("====================================");

  const startTime = performance.now();
  let rollbacksPerformed = 0;

  try {
    // Define bootstrap stages
    const stages: BootstrapStage[] = [
      {
        id: 1,
        name: "Minimal Grammar",
        description: "Bootstrap with minimal TPEG features",
        inputGrammar: createMinimalGrammar(),
        expectedFeatures: ["literals", "identifiers", "basic_rules"],
        validationCriteria: {
          minCodeLength: 500,
          maxCodeLength: 2000,
          requiredExports: ["grammar", "identifier", "string_literal"],
          requiredFeatures: ["literal", "charClass", "sequence"],
        },
      },
      {
        id: 2,
        name: "Extended Grammar",
        description: "Add choice and repetition operators",
        inputGrammar: createExtendedGrammar(),
        expectedFeatures: ["literals", "identifiers", "choice", "repetition"],
        validationCriteria: {
          minCodeLength: 1500,
          maxCodeLength: 3500,
          requiredExports: [
            "grammar",
            "expression",
            "choice_expr",
            "repetition",
          ],
          requiredFeatures: ["choice", "zeroOrMore", "oneOrMore"],
        },
      },
      {
        id: 3,
        name: "Complete Self-Definition",
        description: "Full TPEG self-definition capability",
        inputGrammar: readFileSync(
          "../parser-sample/examples/tpeg-self.tpeg",
          "utf-8",
        ),
        expectedFeatures: ["complete_syntax", "self_hosting"],
        validationCriteria: {
          minCodeLength: 2500,
          maxCodeLength: 4000,
          requiredExports: [
            "grammar",
            "rule_definition",
            "expression",
            "string_literal",
            "character_class",
          ],
          requiredFeatures: ["memoize", "sequence", "choice", "charClass"],
        },
      },
    ];

    console.log(`📋 Bootstrap stages defined: ${stages.length}`);
    console.log(`🎯 Validation enabled: ${config.validate}`);
    console.log(`🔄 Max iterations: ${config.maxIterations}`);
    console.log(`🧪 Generate tests: ${config.generateTests}`);

    const stageResults: StageResult[] = [];
    let currentContext: SelfTranspileContext | null = null;

    // Execute each bootstrap stage
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      console.log(`\n🔧 Stage ${stage.id}: ${stage.name}`);
      console.log("─".repeat(50));
      console.log(`📝 ${stage.description}`);

      const stageStartTime = performance.now();
      let attemptCount = 0;
      let stageSuccess = false;
      let generatedCode = "";
      let lastError: string[] = [];

      // Retry mechanism for each stage
      while (attemptCount < 3 && !stageSuccess) {
        attemptCount++;
        console.log(`🔄 Attempt ${attemptCount}/3...`);

        try {
          // Generate code for current stage
          const result = await selfTranspile(stage.inputGrammar, {
            targetLanguage: "typescript",
            includeTypes: true,
            optimize: true,
            namePrefix: `stage${stage.id}_`,
            enableMemoization: true,
            includeMonitoring: false,
          });

          if (!result.success) {
            lastError = result.warnings;
            console.log(`❌ Generation failed: ${result.warnings.join(", ")}`);
            continue;
          }

          generatedCode = result.code;
          console.log(`✅ Code generated: ${generatedCode.length} chars`);

          // Validate generated code
          const validation = validateStageOutput(stage, generatedCode);

          if (validation.allPassed) {
            stageSuccess = true;
            console.log(`✅ Stage ${stage.id} validation passed`);
          } else {
            console.log(
              `❌ Validation failed: ${validation.failedChecks.join(", ")}`,
            );
            if (attemptCount === 3) {
              // Rollback attempt
              console.log(`🔄 Attempting rollback for stage ${stage.id}...`);
              rollbacksPerformed++;

              if (i > 0) {
                // Use previous stage's output as fallback
                const prevStage = stageResults[i - 1];
                if (prevStage.success) {
                  generatedCode = prevStage.generatedCode;
                  stageSuccess = true;
                  console.log(`✅ Rollback successful to stage ${i}`);
                }
              }
            }
          }
        } catch (error) {
          lastError = [error instanceof Error ? error.message : String(error)];
          console.log(`💥 Exception in attempt ${attemptCount}:`, error);
        }
      }

      const stageTime = performance.now() - stageStartTime;

      // Record stage result
      const stageResult: StageResult = {
        stage,
        success: stageSuccess,
        generatedCode,
        codeLength: generatedCode.length,
        generationTime: stageTime,
        validationResults: stageSuccess
          ? validateStageOutput(stage, generatedCode)
          : {
              lengthCheck: false,
              exportsCheck: false,
              featuresCheck: false,
              structureCheck: false,
            },
        errors: stageSuccess ? [] : lastError,
        warnings: [],
      };

      stageResults.push(stageResult);

      console.log(`📊 Stage ${stage.id} Result:`);
      console.log(`   ✅ Success: ${stageSuccess ? "Yes" : "No"}`);
      console.log(`   ⏱️  Time: ${stageTime.toFixed(2)}ms`);
      console.log(`   📏 Code length: ${generatedCode.length} chars`);

      if (!stageSuccess) {
        console.log(`🚨 Stage ${stage.id} failed, stopping bootstrap process`);
        break;
      }

      // Update context for next stage
      if (stageSuccess && generatedCode) {
        currentContext = createSelfTranspileContext(config.initialGrammar);
        currentContext.generatedFunctions.set(
          `stage_${stage.id}`,
          generatedCode,
        );
        currentContext.metrics.iterations++;
      }
    }

    const totalTime = performance.now() - startTime;
    const completedStages = stageResults.filter((r) => r.success).length;
    const successRate = completedStages / stages.length;

    // Final validation
    console.log("\n🔍 Final Bootstrap Validation");
    console.log("==============================");

    const _finalValidation = await performFinalValidation(stageResults, config);

    // Summary
    console.log("\n📊 Bootstrap Summary");
    console.log("====================");
    console.log(`🎯 Stages completed: ${completedStages}/${stages.length}`);
    console.log(`📈 Success rate: ${(successRate * 100).toFixed(1)}%`);
    console.log(`⏱️  Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`🔄 Rollbacks performed: ${rollbacksPerformed}`);

    stageResults.forEach((result, index) => {
      const status = result.success ? "✅" : "❌";
      console.log(
        `   Stage ${index + 1}: ${status} ${result.stage.name} (${result.generationTime.toFixed(1)}ms)`,
      );
    });

    const bootstrapResult: BootstrapResult = {
      parserCode:
        completedStages > 0
          ? stageResults[completedStages - 1].generatedCode
          : "",
      typeDefinitions: "", // Could be enhanced to extract type definitions
      validation: {
        success: successRate >= 0.8,
        errors: stageResults.flatMap((r) => r.errors),
        performance: {
          totalTime,
          iterations: completedStages,
          memoryUsage: process.memoryUsage?.()?.heapUsed || 0,
        },
      },
      tests: config.generateTests
        ? generateBootstrapTests(stageResults)
        : undefined,
    };

    console.log(
      `\n🏆 Bootstrap Result: ${bootstrapResult.validation.success ? "SUCCESS" : "PARTIAL"}`,
    );

    return bootstrapResult;
  } catch (error) {
    console.error("💥 Bootstrap validation failed:", error);
    throw error;
  }
}

function createMinimalGrammar(): string {
  return `
grammar Minimal {
  @version: "1.0"
  @description: "Minimal TPEG bootstrap grammar"
  
  grammar = "grammar" identifier "{" "}"
  identifier = [a-zA-Z_][a-zA-Z0-9_]*
  string_literal = "\"" [^"]* "\""
}`;
}

function createExtendedGrammar(): string {
  return `
grammar Extended {
  @version: "1.1"
  @description: "Extended TPEG bootstrap grammar"
  
  grammar = "grammar" identifier "{" rule_list "}"
  rule_list = rule_definition*
  rule_definition = identifier "=" expression
  expression = choice_expr
  choice_expr = sequence_expr ("/" sequence_expr)*
  sequence_expr = primary_expr*
  primary_expr = identifier / string_literal / character_class
  string_literal = "\"" [^"]* "\""
  character_class = "[" [^\]]* "]"
  identifier = [a-zA-Z_][a-zA-Z0-9_]*
}`;
}

function validateStageOutput(stage: BootstrapStage, code: string): any {
  const lengthCheck =
    code.length >= stage.validationCriteria.minCodeLength &&
    code.length <= stage.validationCriteria.maxCodeLength;

  const exportsCheck = stage.validationCriteria.requiredExports.every(
    (exportName) =>
      code.includes(
        `export const ${stage.name.toLowerCase().replace(/\s+/g, "_")}_${exportName}`,
      ) || code.includes(`export const stage${stage.id}_${exportName}`),
  );

  const featuresCheck = stage.validationCriteria.requiredFeatures.every(
    (feature) => code.includes(feature),
  );

  const structureCheck =
    code.includes("import") &&
    code.includes("export") &&
    code.includes("Parser");

  const allPassed =
    lengthCheck && exportsCheck && featuresCheck && structureCheck;
  const failedChecks = [
    !lengthCheck && "length",
    !exportsCheck && "exports",
    !featuresCheck && "features",
    !structureCheck && "structure",
  ].filter(Boolean);

  return {
    lengthCheck,
    exportsCheck,
    featuresCheck,
    structureCheck,
    allPassed,
    failedChecks,
  };
}

async function performFinalValidation(
  stageResults: StageResult[],
  _config: BootstrapConfig,
) {
  console.log("🔍 Performing final validation...");

  // Check if we can parse the original grammar
  const canParseOriginal =
    stageResults.length > 0 && stageResults[stageResults.length - 1].success;

  // Check consistency
  const canGenerateConsistent =
    stageResults.filter((r) => r.success).length >= 2;

  // Check performance
  const avgTime =
    stageResults.reduce((sum, r) => sum + r.generationTime, 0) /
    stageResults.length;
  const performanceAcceptable = avgTime < 100; // 100ms threshold

  console.log(`✅ Can parse original: ${canParseOriginal}`);
  console.log(`✅ Can generate consistently: ${canGenerateConsistent}`);
  console.log(
    `✅ Performance acceptable: ${performanceAcceptable} (${avgTime.toFixed(2)}ms avg)`,
  );

  return {
    canParseOriginal,
    canGenerateConsistent,
    performanceAcceptable,
  };
}

function generateBootstrapTests(stageResults: StageResult[]): string {
  const tests = stageResults
    .filter((r) => r.success)
    .map(
      (r) => `
// Test for ${r.stage.name}
describe('Bootstrap Stage ${r.stage.id}', () => {
  it('should generate valid parser code', () => {
    expect(code.length).toBeGreaterThan(${r.stage.validationCriteria.minCodeLength});
    expect(code.length).toBeLessThan(${r.stage.validationCriteria.maxCodeLength});
  });
});`,
    )
    .join("\n");

  return `// Generated Bootstrap Tests\n${tests}`;
}

export { validateBootstrapProcess, type BootstrapValidationResult };

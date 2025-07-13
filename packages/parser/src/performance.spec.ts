/**
 * TPEG Parser Performance Benchmarks and Optimization Tests
 *
 * This module provides comprehensive performance testing for:
 * - Grammar parsing performance
 * - Code generation performance
 * - Large input handling
 * - Memory usage optimization
 * - Recursive pattern performance
 */

import { describe, expect, it } from "bun:test";
import { generateTypeScriptParser, grammarDefinition } from "./index";
import {
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createPlus,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "./types";

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  operationsPerSecond: number;
}

/**
 * High-performance benchmark runner with statistical analysis
 */
function benchmark(
  name: string,
  operation: () => void,
  iterations = 10000,
): BenchmarkResult {
  // Warm-up phase
  for (let i = 0; i < Math.min(100, iterations / 10); i++) {
    operation();
  }

  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    operation();
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;
  const averageTime = totalTime / iterations;
  const operationsPerSecond = 1000 / averageTime;

  return {
    name,
    iterations,
    totalTime,
    averageTime,
    operationsPerSecond,
  };
}

/**
 * Memory usage measurement utility
 */
function measureMemory(operation: () => void): {
  before: number;
  after: number;
  delta: number;
} {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  const before = process.memoryUsage().heapUsed;
  operation();
  const after = process.memoryUsage().heapUsed;

  return {
    before,
    after,
    delta: after - before,
  };
}

describe("TPEG Parser Performance Benchmarks", () => {
  describe("Grammar Parsing Performance", () => {
    it("should parse simple grammars efficiently", () => {
      const simpleGrammar = `grammar Simple {
        @version: "1.0"
        letter = [a-z]
      }`;

      const result = benchmark(
        "Simple Grammar Parsing",
        () => {
          const pos = { offset: 0, line: 1, column: 1 };
          grammarDefinition(simpleGrammar, pos);
        },
        1000,
      );

      console.log(
        `${result.name}: ${result.operationsPerSecond.toFixed(0)} ops/sec`,
      );
      expect(result.operationsPerSecond).toBeGreaterThan(500); // Should parse 500+ simple grammars per second
    });

    it("should parse complex grammars efficiently", () => {
      const complexGrammar = `grammar Complex {
        @version: "2.0"
        @description: "Complex multi-rule grammar"
        @author: "Performance Test"
        
        expression = term (('+' / '-') term)*
        term = factor (('*' / '/') factor)*
        factor = number / '(' expression ')'
        number = [0-9]+
        whitespace = [ \\t\\n\\r]*
      }`;

      const result = benchmark(
        "Complex Grammar Parsing",
        () => {
          const pos = { offset: 0, line: 1, column: 1 };
          grammarDefinition(complexGrammar, pos);
        },
        500,
      );

      console.log(
        `${result.name}: ${result.operationsPerSecond.toFixed(0)} ops/sec`,
      );
      expect(result.operationsPerSecond).toBeGreaterThan(100); // Should parse 100+ complex grammars per second
    });

    it("should handle large grammars without performance degradation", () => {
      // Generate a large grammar with many rules
      const rules = Array.from(
        { length: 100 },
        (_, i) => `rule${i} = "value${i}"`,
      ).join("\n        ");

      const largeGrammar = `grammar Large {
        @version: "1.0"
        @description: "Large grammar with many rules"
        
        ${rules}
      }`;

      const result = benchmark(
        "Large Grammar Parsing",
        () => {
          const pos = { offset: 0, line: 1, column: 1 };
          grammarDefinition(largeGrammar, pos);
        },
        50,
      );

      console.log(
        `${result.name}: ${result.operationsPerSecond.toFixed(0)} ops/sec`,
      );
      expect(result.operationsPerSecond).toBeGreaterThan(10); // Should still parse large grammars reasonably fast
    });
  });

  describe("Code Generation Performance", () => {
    it("should generate TypeScript code efficiently", () => {
      const grammar = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "letter",
            createCharacterClass([createCharRange("a", "z")], false),
          ),
          createRuleDefinition(
            "digit",
            createCharacterClass([createCharRange("0", "9")], false),
          ),
          createRuleDefinition(
            "word",
            createPlus(
              createChoice([
                { type: "Identifier", name: "letter" },
                { type: "Identifier", name: "digit" },
              ]),
            ),
          ),
        ],
      );

      const result = benchmark(
        "TypeScript Code Generation",
        () => {
          generateTypeScriptParser(grammar, {
            namePrefix: "test_",
            includeImports: true,
            includeTypes: true,
          });
        },
        1000,
      );

      console.log(
        `${result.name}: ${result.operationsPerSecond.toFixed(0)} ops/sec`,
      );
      expect(result.operationsPerSecond).toBeGreaterThan(200); // Should generate 200+ parsers per second
    });

    it("should handle complex AST structures efficiently", () => {
      // Create a complex nested AST structure
      const complexExpression = createSequence([
        createChoice([
          createStringLiteral("hello"),
          createStringLiteral("world"),
        ]),
        createStar(createCharacterClass([createCharRange("a", "z")], false)),
        createPlus(createCharacterClass([createCharRange("0", "9")], false)),
      ]);

      const grammar = createGrammarDefinition(
        "ComplexGrammar",
        [],
        [createRuleDefinition("complex", complexExpression)],
      );

      const result = benchmark(
        "Complex AST Code Generation",
        () => {
          generateTypeScriptParser(grammar);
        },
        500,
      );

      console.log(
        `${result.name}: ${result.operationsPerSecond.toFixed(0)} ops/sec`,
      );
      expect(result.operationsPerSecond).toBeGreaterThan(100);
    });
  });

  describe("Memory Usage Optimization", () => {
    it("should parse grammars with minimal memory overhead", () => {
      const grammar = `grammar MemoryTest {
        @version: "1.0"
        simple = "test"
      }`;

      const memoryUsage = measureMemory(() => {
        for (let i = 0; i < 100; i++) {
          const pos = { offset: 0, line: 1, column: 1 };
          const result = grammarDefinition(grammar, pos);
          if (!result.success) throw new Error("Parse failed");
        }
      });

      console.log(
        `Memory usage for 100 grammar parses: ${(memoryUsage.delta / 1024).toFixed(2)} KB`,
      );
      expect(memoryUsage.delta).toBeLessThan(1024 * 1024); // Should use less than 1MB for 100 parses
    });

    it("should generate code with minimal memory allocation", () => {
      const grammar = createGrammarDefinition(
        "MemoryGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("hello"))],
      );

      const memoryUsage = measureMemory(() => {
        for (let i = 0; i < 100; i++) {
          generateTypeScriptParser(grammar);
        }
      });

      console.log(
        `Memory usage for 100 code generations: ${(memoryUsage.delta / 1024).toFixed(2)} KB`,
      );
      expect(memoryUsage.delta).toBeLessThan(2 * 1024 * 1024); // Should use less than 2MB for 100 generations
    });
  });

  describe("Scalability Tests", () => {
    it("should scale linearly with grammar size", () => {
      const sizes = [10, 25, 50, 100];
      const results: Array<{ size: number; opsPerSec: number }> = [];

      for (const size of sizes) {
        const rules = Array.from(
          { length: size },
          (_, i) => `rule${i} = "value${i}"`,
        ).join("\n        ");

        const grammar = `grammar ScaleTest${size} {
          @version: "1.0"
          ${rules}
        }`;

        const result = benchmark(
          `Grammar Size ${size}`,
          () => {
            const pos = { offset: 0, line: 1, column: 1 };
            grammarDefinition(grammar, pos);
          },
          Math.max(10, 200 / size), // Fewer iterations for larger grammars
        );

        results.push({ size, opsPerSec: result.operationsPerSecond });
        console.log(
          `Size ${size}: ${result.operationsPerSecond.toFixed(1)} ops/sec`,
        );
      }

      // Check that performance doesn't degrade exponentially
      const firstResult = results[0];
      const lastResult = results[results.length - 1];
      const scalingFactor = firstResult.opsPerSec / lastResult.opsPerSec;
      const expectedMaxScaling = (sizes[sizes.length - 1] / sizes[0]) ** 1.5; // Allow for slightly worse than linear

      console.log(
        `Scaling factor: ${scalingFactor.toFixed(2)}x (should be < ${expectedMaxScaling.toFixed(2)}x)`,
      );
      expect(scalingFactor).toBeLessThan(expectedMaxScaling);
    });

    it("should handle deeply nested expressions efficiently", () => {
      // Create deeply nested expression: ((((a))))
      let nestedExpr: Expression = createStringLiteral("a");
      const depth = 50;

      for (let i = 0; i < depth; i++) {
        nestedExpr = {
          type: "Group",
          expression: nestedExpr,
        };
      }

      const grammar = createGrammarDefinition(
        "DeepNested",
        [],
        [createRuleDefinition("deep", nestedExpr)],
      );

      const result = benchmark(
        "Deep Nesting Code Generation",
        () => {
          generateTypeScriptParser(grammar);
        },
        100,
      );

      console.log(
        `Deep nesting (${depth} levels): ${result.operationsPerSecond.toFixed(1)} ops/sec`,
      );
      expect(result.operationsPerSecond).toBeGreaterThan(10); // Should handle deep nesting without crashing
    });
  });

  describe("Real-World Performance", () => {
    it("should parse JSON grammar efficiently", () => {
      // Use a simpler JSON grammar that our current parser can handle
      const jsonGrammar = `grammar JSON {
        @version: "2.0"
        @description: "Simple JSON parser"
        
        value = string / number / boolean / null
        string = '"' [^"]* '"'
        number = [0-9]+
        boolean = "true" / "false"
        null = "null"
      }`;

      const result = benchmark(
        "JSON Grammar Parsing",
        () => {
          const pos = { offset: 0, line: 1, column: 1 };
          const parseResult = grammarDefinition(jsonGrammar, pos);
          if (!parseResult.success) throw new Error("Parse failed");
        },
        100,
      );

      console.log(
        `JSON Grammar: ${result.operationsPerSecond.toFixed(1)} ops/sec`,
      );
      expect(result.operationsPerSecond).toBeGreaterThan(20);
    });

    it("should generate parsers for practical grammars quickly", () => {
      const calculatorGrammar = `grammar Calculator {
        @version: "1.0"
        @description: "Arithmetic calculator"
        
        expression = term (('+' / '-') term)*
        term = factor (('*' / '/') factor)*
        factor = number / '(' ws expression ws ')'
        number = [0-9]+ ('.' [0-9]+)?
        ws = [ \\t]*
      }`;

      let parseResult: ReturnType<typeof grammarDefinition>;
      const parseTime = benchmark(
        "Calculator Parse",
        () => {
          const pos = { offset: 0, line: 1, column: 1 };
          parseResult = grammarDefinition(calculatorGrammar, pos);
          if (!parseResult.success) throw new Error("Parse failed");
        },
        200,
      );

      const generateTime = benchmark(
        "Calculator Code Generation",
        () => {
          generateTypeScriptParser(parseResult.val, {
            namePrefix: "calc_",
            includeImports: true,
            includeTypes: true,
          });
        },
        500,
      );

      console.log(
        `Calculator Parse: ${parseTime.operationsPerSecond.toFixed(1)} ops/sec`,
      );
      console.log(
        `Calculator Generate: ${generateTime.operationsPerSecond.toFixed(1)} ops/sec`,
      );

      expect(parseTime.operationsPerSecond).toBeGreaterThan(50);
      expect(generateTime.operationsPerSecond).toBeGreaterThan(100);
    });
  });
});

describe("Performance Regression Prevention", () => {
  it("should maintain baseline performance for core operations", () => {
    const baselines = {
      simpleGrammarParsing: 500, // ops/sec
      codeGeneration: 200, // ops/sec
      memoryPerParse: 10 * 1024, // bytes
    };

    // Simple grammar parsing baseline
    const simpleResult = benchmark(
      "Baseline Simple Grammar",
      () => {
        const pos = { offset: 0, line: 1, column: 1 };
        grammarDefinition('grammar Test { rule = "test" }', pos);
      },
      1000,
    );

    // Code generation baseline
    const grammar = createGrammarDefinition(
      "Test",
      [],
      [createRuleDefinition("test", createStringLiteral("hello"))],
    );

    const codeGenResult = benchmark(
      "Baseline Code Generation",
      () => {
        generateTypeScriptParser(grammar);
      },
      1000,
    );

    console.log("=== PERFORMANCE BASELINES ===");
    console.log(
      `Simple Grammar Parsing: ${simpleResult.operationsPerSecond.toFixed(0)} ops/sec (baseline: ${baselines.simpleGrammarParsing})`,
    );
    console.log(
      `Code Generation: ${codeGenResult.operationsPerSecond.toFixed(0)} ops/sec (baseline: ${baselines.codeGeneration})`,
    );

    // Allow 20% performance variance
    expect(simpleResult.operationsPerSecond).toBeGreaterThan(
      baselines.simpleGrammarParsing * 0.8,
    );
    expect(codeGenResult.operationsPerSecond).toBeGreaterThan(
      baselines.codeGeneration * 0.8,
    );
  });
});

/**
 * TPEG Transforms Parser Tests
 *
 * Tests for parsing transform definitions in TPEG grammar.
 * Based on docs/peg-grammar.md specification.
 */

import { describe, expect, it } from "bun:test";
import { parse } from "@suzumiyaaoba/tpeg-core";
import type { Pos } from "@suzumiyaaoba/tpeg-core";
import {
  parameterList,
  parameterType,
  returnTypeSpec,
  targetLanguage,
  transformDefinition,
  transformFunction,
  transformFunctions,
  transformSet,
  transformSetName,
  transformsKeyword,
} from "./transforms";

/**
 * Test position for parsing
 */
const _TEST_POS: Pos = { offset: 0, line: 1, column: 1 };

describe("transformsKeyword", () => {
  it("should parse 'transforms' keyword", () => {
    const result = parse(transformsKeyword)("transforms");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toBe("transforms");
    }
  });

  it("should fail for other keywords", () => {
    const result = parse(transformsKeyword)("grammar");
    expect(result.success).toBe(false);
  });
});

describe("targetLanguage", () => {
  it("should parse supported languages", () => {
    const languages = ["typescript", "python", "go", "rust", "java", "cpp"];

    for (const lang of languages) {
      const result = parse(targetLanguage)(lang);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val).toBe(lang);
      }
    }
  });

  it("should fail for unsupported languages", () => {
    const result = parse(targetLanguage)("javascript");
    console.log("targetLanguage result:", JSON.stringify(result, null, 2));
    expect(result.success).toBe(false);
  });
});

describe("transformSetName", () => {
  it("should parse transform set name with language", () => {
    const result = parse(transformSetName)("ArithmeticEvaluator@typescript");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("ArithmeticEvaluator");
      expect(result.val.language).toBe("typescript");
    }
  });

  it("should parse with whitespace", () => {
    const result = parse(transformSetName)("MyTransforms @ python");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("MyTransforms");
      expect(result.val.language).toBe("python");
    }
  });

  it("should fail without language separator", () => {
    const result = parse(transformSetName)("ArithmeticEvaluator");
    expect(result.success).toBe(false);
  });
});

describe("parameterType", () => {
  it("should parse parameter type annotation", () => {
    const result = parse(parameterType)("captures: string");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("captures");
      expect(result.val.type).toBe("string");
    }
  });

  it("should parse with whitespace", () => {
    const result = parse(parameterType)("value : number");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("value");
      expect(result.val.type).toBe("number");
    }
  });
});

describe("parameterList", () => {
  it("should parse empty parameter list", () => {
    const result = parse(parameterList)("()");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toEqual([]);
    }
  });

  it("should parse single parameter", () => {
    const result = parse(parameterList)("(captures: string)");
    console.log("parameterList result:", JSON.stringify(result, null, 2));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toHaveLength(1);
      expect(result.val[0].name).toBe("captures");
      expect(result.val[0].type).toBe("string");
    }
  });

  it("should parse multiple parameters", () => {
    const result = parse(parameterList)("(left: number, right: number)");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toHaveLength(2);
      expect(result.val[0].name).toBe("left");
      expect(result.val[0].type).toBe("number");
      expect(result.val[1].name).toBe("right");
      expect(result.val[1].type).toBe("number");
    }
  });
});

describe("returnTypeSpec", () => {
  it("should parse return type specification", () => {
    const result = parse(returnTypeSpec)("-> Result<number>");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("Result");
      expect(result.val.generic).toBe("number");
    }
  });

  it("should parse simple return type", () => {
    const result = parse(returnTypeSpec)("-> string");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("string");
    }
  });
});

describe("transformFunction", () => {
  it("should parse simple transform function", () => {
    const input = `number(captures: string) -> Result<number> {
      return { success: true, value: parseInt(captures, 10) };
    }`;

    const result = parse(transformFunction)(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("number");
      expect(result.val.parameters).toHaveLength(1);
      expect(result.val.parameters[0].name).toBe("captures");
      expect(result.val.parameters[0].type).toBe("string");
      expect(result.val.returnType.type).toBe("Result");
      expect(result.val.body).toContain("parseInt");
    }
  });
});

describe("transformSet", () => {
  it("should parse complete transform set", () => {
    const input = `transforms ArithmeticEvaluator@typescript {
      number(captures: string) -> Result<number> {
        return { success: true, value: parseInt(captures, 10) };
      }
      
      expression(captures: { left: number, right: number }) -> Result<number> {
        return { success: true, value: captures.left + captures.right };
      }
    }`;

    console.log("Input length:", input.length);
    console.log("Character at position 181:", input[181]);
    console.log("Characters around position 181:", input.slice(175, 185));

    const result = parse(transformSet)(input);
    console.log("transformSet result:", JSON.stringify(result, null, 2));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("ArithmeticEvaluator");
      expect(result.val.targetLanguage).toBe("typescript");
      expect(result.val.functions).toHaveLength(2);
      expect(result.val.functions[0].name).toBe("number");
      expect(result.val.functions[1].name).toBe("expression");
    }
  });
});

describe("transformDefinition", () => {
  it("should parse complete transform definition", () => {
    const input = `transforms ArithmeticEvaluator@typescript {
      number(captures: string) -> Result<number> {
        return { success: true, value: parseInt(captures, 10) };
      }
    }`;

    const result = parse(transformDefinition)(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("TransformDefinition");
      expect(result.val.transformSet.name).toBe("ArithmeticEvaluator");
      expect(result.val.transformSet.targetLanguage).toBe("typescript");
      expect(result.val.transformSet.functions).toHaveLength(1);
    }
  });

  it("should parse Python transform definition", () => {
    const input = `transforms ArithmeticEvaluator@python {
      number(captures: { digits: string }) -> Result<int> {
        try:
          value = int(captures['digits'])
          return {'success': True, 'value': value}
        except ValueError:
          return {'success': False, 'error': 'Invalid number format'}
      }
    }`;

    const result = parse(transformDefinition)(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.transformSet.targetLanguage).toBe("python");
      expect(result.val.transformSet.functions).toHaveLength(1);
      expect(result.val.transformSet.functions[0].name).toBe("number");
    }
  });
});

describe("transformFunctions", () => {
  it("should parse multiple functions", () => {
    const input = `number(captures: string) -> Result<number> {
      return { success: true, value: parseInt(captures, 10) };
    }
    
    expression(captures: { left: number, right: number }) -> Result<number> {
      return { success: true, value: captures.left + captures.right };
    }`;

    const result = parse(transformFunctions)(input);
    console.log("transformFunctions result:", JSON.stringify(result, null, 2));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toHaveLength(2);
      expect(result.val[0].name).toBe("number");
      expect(result.val[1].name).toBe("expression");
    }
  });
});

/**
 * TPEG Transforms Parser Tests
 *
 * Tests for parsing transform definitions in TPEG grammar.
 * Based on docs/peg-grammar.md specification.
 */

import { describe, expect, it } from "vite-plus/test";
import { parse } from "@suzumiyaaoba/tpeg-core";
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
      expect(result.val[0]?.name).toBe("captures");
      expect(result.val[0]?.type).toBe("string");
    }
  });

  it("should parse multiple parameters", () => {
    const result = parse(parameterList)("(left: number, right: number)");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toHaveLength(2);
      expect(result.val[0]?.name).toBe("left");
      expect(result.val[0]?.type).toBe("number");
      expect(result.val[1]?.name).toBe("right");
      expect(result.val[1]?.type).toBe("number");
    }
  });

  it("should parse a parameter with a multi-argument generic type", () => {
    const result = parse(parameterList)("(a: Map<string, number>)");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toHaveLength(1);
      expect(result.val[0]?.type).toBe("Map<string, number>");
    }
  });

  it("should parse a parameter with a union type", () => {
    const result = parse(parameterList)("(a: string | number, b: boolean)");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val[0]?.type).toBe("string | number");
      expect(result.val[1]?.type).toBe("boolean");
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

  it("should keep a union type intact instead of truncating to its first member", () => {
    const result = parse(returnTypeSpec)("-> string | number");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("string | number");
      expect(result.next).toBe("-> string | number".length);
    }
  });

  it("should keep an intersection type intact", () => {
    const result = parse(returnTypeSpec)("-> A & B");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("A & B");
    }
  });

  it("should keep multi-argument generic parameters", () => {
    const result = parse(returnTypeSpec)("-> Map<string, number>");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("Map");
      expect(result.val.generic).toBe("string, number");
    }
  });

  it("should keep nested generic arguments", () => {
    const result = parse(returnTypeSpec)("-> Result<Array<number>>");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("Result");
      expect(result.val.generic).toBe("Array<number>");
    }
  });

  it("should keep array suffixes", () => {
    const result = parse(returnTypeSpec)("-> number[]");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("number[]");
    }
  });

  it("should keep an object-literal return type", () => {
    const result = parse(returnTypeSpec)("-> { x: number }");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.type).toBe("{ x: number }");
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
      expect(result.val.parameters[0]?.name).toBe("captures");
      expect(result.val.parameters[0]?.type).toBe("string");
      expect(result.val.returnType.type).toBe("Result");
      expect(result.val.body).toContain("parseInt");
    }
  });

  it("should reject garbage between the return type and the body (#53)", () => {
    const result = parse(transformFunction)(
      "f(captures: string) -> number GARBAGE { return 1; }",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.pos).toBe(30);
    }
  });

  it("should fail cleanly at the next declaration when the body is missing (#53)", () => {
    const input = [
      "f(captures: string) -> number",
      "g(captures: string) -> number { return 1; }",
    ].join("\n");
    const result = parse(transformFunction)(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.pos).toBe(30);
      expect(result.error.message).toContain("{");
    }
  });

  it("should accept comments between the return type and the body", () => {
    const blockComment = parse(transformFunction)(
      "f(captures: string) -> number /* c */ { return 1; }",
    );
    expect(blockComment.success).toBe(true);
    const lineComment = parse(transformFunction)(
      "f(captures: string) -> number // c\n{ return 1; }",
    );
    expect(lineComment.success).toBe(true);
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
      expect(result.val.functions[0]?.name).toBe("number");
      expect(result.val.functions[1]?.name).toBe("expression");
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
      expect(result.val.transformSet.functions[0]?.name).toBe("number");
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
      expect(result.val[0]?.name).toBe("number");
      expect(result.val[1]?.name).toBe("expression");
    }
  });

  it("should accept a line comment between two functions (issue #52)", () => {
    const input = `f(a: number) -> number { return a; }
    // hi
    g(b: number) -> number { return b; }`;

    const result = parse(transformFunctions)(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.map((f) => f.name)).toEqual(["f", "g"]);
    }
  });

  it("should accept a block comment between two functions", () => {
    const input = `f(a: number) -> number { return a; }
    /* hi */
    g(b: number) -> number { return b; }`;

    const result = parse(transformFunctions)(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.map((f) => f.name)).toEqual(["f", "g"]);
    }
  });

  it("should accept comments around the transformSetName language separator and braces", () => {
    const result = parse(transformSet)(
      `transforms X /* c */ @typescript /* c */ { /* c */ f(a: number) -> number { return a; } /* c */ }`,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("X");
      expect(result.val.functions.map((f) => f.name)).toEqual(["f"]);
    }
  });

  it("should accept comments inside a function signature's trivia positions", () => {
    const result = parse(transformFunction)(
      `f /* c */ (a: number) -> number /* c */ { return a; }`,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.name).toBe("f");
    }
  });
});

describe("comments in transform signature positions (issue #62)", () => {
  // The signature's ":", ",", and "->" separators only skipped plain
  // whitespace (optionalWhitespace), not comments -- inconsistent with
  // every other separator in the grammar, which is comment-tolerant.
  const accepts = (src: string, label: string) => {
    it(label, () => {
      const result = parse(transformFunction)(src);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.name).toBe("f");
      }
    });
  };

  accepts(
    `f(a /* c */: string) -> string { return a; }`,
    "comment between a parameter name and ':'",
  );
  accepts(
    `f(a: /* c */ string) -> string { return a; }`,
    "comment between ':' and the parameter type",
  );
  accepts(
    `f(a: string, /* c */ b: number) -> string { return a; }`,
    "comment after ',' inside the parameter list",
  );
  accepts(
    `f(a: string /* c */, b: number) -> string { return a; }`,
    "comment before ',' inside the parameter list",
  );
  accepts(
    `f( /* c */ a: string) -> string { return a; }`,
    "comment right after '('",
  );
  accepts(
    `f(a: string) /* c */ -> string { return a; }`,
    "comment between ')' and '->'",
  );
  accepts(
    `f(a: string) -> /* c */ string { return a; }`,
    "comment between '->' and the return type",
  );
  accepts(
    `f(a: string) // c\n -> string { return a; }`,
    "line comment between ')' and '->'",
  );
  accepts(
    `f(a: Map<string, /* c */ number>) -> string { return a; }`,
    "comment inside a generic type's argument list",
  );

  it("a malformed signature still fails (comment tolerance doesn't widen the grammar)", () => {
    const result = parse(transformFunction)(
      `f(a /* c */ string) -> string { return a; }`,
    );
    expect(result.success).toBe(false);
  });
});

describe("transform function documentation comments (issue #67)", () => {
  // `///` lines before a function attach to its `documentation` field --
  // transformFunction's leading separator collects them (previously they
  // were silently discarded as ordinary comments).
  it("attaches a /// comment before a function to its documentation", () => {
    const result = parse(transformFunction)(
      `/// Adds one\nf(a: number) -> number { return a; }`,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.documentation).toEqual(["Adds one"]);
    }
  });

  it("collects /// docs between two functions onto the following one", () => {
    const result = parse(transformFunctions)(
      `f(a: number) -> number { return a; }\n/// Doc for g\ng(b: number) -> number { return b; }`,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val).toHaveLength(2);
      expect(result.val[0]?.documentation).toBeUndefined();
      expect(result.val[1]?.documentation).toEqual(["Doc for g"]);
    }
  });

  it("a // comment between functions is not documentation", () => {
    const result = parse(transformFunctions)(
      `f(a: number) -> number { return a; }\n// plain comment\ng(b: number) -> number { return b; }`,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val[1]?.documentation).toBeUndefined();
    }
  });

  // Issue #116: transformSet used to place a plain
  // optionalWhitespaceOrComment between "{" and transformFunctions, which
  // consumed a `///` line before the FIRST function as an ordinary comment
  // (later functions' docs survived via docCollectingSeparator).
  it("attaches /// docs to the FIRST function of a transform set", () => {
    const result = parse(transformDefinition)(
      `transforms T@typescript {\n  /// docs for a\n  a() -> X { return 1; }\n  /// docs for b\n  b() -> Y { return 2; }\n}`,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.val.transformSet.functions[0]?.documentation).toEqual([
        "docs for a",
      ]);
      expect(result.val.transformSet.functions[1]?.documentation).toEqual([
        "docs for b",
      ]);
    }
  });
});

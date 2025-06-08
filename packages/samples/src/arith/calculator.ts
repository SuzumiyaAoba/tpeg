import {
  type Parser,
  any,
  charClass,
  choice,
  lit,
  map,
  not,
  oneOrMore,
  parse,
  seq,
  star,
} from "tpeg-core";

// =============================================================================
// 1. Basic Token Parsers
// =============================================================================

/**
 * Whitespace characters (space, tab, newline)
 */
export const Whitespace = charClass(" ", "\t", "\n", "\r");

/**
 * Optional whitespace
 */
export const _ = star(Whitespace);

/**
 * Single digit
 */
export const Digit = charClass(["0", "9"]);

/**
 * Integer
 */
export const Integer = map(oneOrMore(Digit), (digits) =>
  Number.parseInt(digits.join(""), 10),
);

/**
 * Floating point number
 */
export const Float = map(
  seq(oneOrMore(Digit), lit("."), oneOrMore(Digit)),
  ([intPart, , fracPart]) =>
    Number.parseFloat(`${intPart.join("")}.${fracPart.join("")}`),
);

/**
 * Number (integer or floating point)
 */
export const NumberParser = choice(Float, Integer);

// =============================================================================
// 2. AST Definitions
// =============================================================================

export interface NumberNode {
  type: "number";
  value: number;
}

export interface BinaryOpNode {
  type: "binaryOp";
  operator: "+" | "-" | "*" | "/" | "%";
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface UnaryOpNode {
  type: "unaryOp";
  operator: "+" | "-";
  operand: ExpressionNode;
}

export interface GroupNode {
  type: "group";
  expression: ExpressionNode;
}

export type ExpressionNode =
  | NumberNode
  | BinaryOpNode
  | UnaryOpNode
  | GroupNode;

// =============================================================================
// 3. AST Builder Functions
// =============================================================================

export const createNumber = (value: number) => ({
  type: "number" as const,
  value,
});

export const createBinaryOp = (
  operator: BinaryOpNode["operator"],
  left: ExpressionNode,
  right: ExpressionNode,
) => ({
  type: "binaryOp" as const,
  operator,
  left,
  right,
});

export const createUnaryOp = (
  operator: UnaryOpNode["operator"],
  operand: ExpressionNode,
) => ({
  type: "unaryOp" as const,
  operator,
  operand,
});

export const createGroup = (expression: ExpressionNode) => ({
  type: "group" as const,
  expression,
});

// =============================================================================
// 4. Evaluator
// =============================================================================

export function evaluate(node: ExpressionNode): number {
  switch (node.type) {
    case "number":
      return node.value;

    case "binaryOp": {
      const left = evaluate(node.left);
      const right = evaluate(node.right);

      const operator = node.operator;
      switch (operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          if (right === 0) throw new Error("Division by zero");
          return left / right;
        case "%":
          if (right === 0) throw new Error("Modulo by zero");
          return left % right;
        default: {
          const exhaustiveCheck: never = operator;
          throw new Error(`Unreachable: ${exhaustiveCheck}`);
        }
      }
    }

    case "unaryOp": {
      const operand = evaluate(node.operand);

      const operator = node.operator;
      switch (operator) {
        case "+":
          return +operand;
        case "-":
          return -operand;
        default: {
          const exhaustiveCheck: never = operator;
          throw new Error(`Unreachable: ${exhaustiveCheck}`);
        }
      }
    }

    case "group":
      return evaluate(node.expression);

    default: {
      const exhaustiveCheck: never = node;
      throw new Error(`Unknown node type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

// =============================================================================
// 5. Parser (AST Construction)
// =============================================================================

/**
 * Number literal
 */
export const NumberLiteral = map(seq(_, NumberParser, _), ([, value]) =>
  createNumber(value),
);

/**
 * Factor (number or parenthesized expression)
 */
export const Factor: Parser<ExpressionNode> = choice(
  // Parenthesized expression
  map(
    seq(_, lit("("), _, (input, pos) => Expression(input, pos), _, lit(")"), _),
    ([, , , expr]) => createGroup(expr),
  ),
  // Signed number
  map(
    seq(_, choice(lit("+"), lit("-")), NumberLiteral),
    ([, operator, operand]) => createUnaryOp(operator as "+" | "-", operand),
  ),
  // Regular number
  NumberLiteral,
);

/**
 * Term (multiplication, division, modulo with map-based left associativity)
 */
export const Term: Parser<ExpressionNode> = map(
  seq(
    Factor,
    star(
      choice(
        seq(_, lit("*"), _, Factor),
        seq(_, lit("/"), _, Factor),
        seq(_, lit("%"), _, Factor),
      ),
    ),
  ),
  ([first, rest]) => {
    // Construct AST using map functions
    return rest.reduce(
      (left, [, operator, , right]) => createBinaryOp(operator, left, right),
      first,
    );
  },
);

/**
 * Expression (addition, subtraction with map-based left associativity)
 */
export const Expression: Parser<ExpressionNode> = map(
  seq(Term, star(choice(seq(_, lit("+"), _, Term), seq(_, lit("-"), _, Term)))),
  ([first, rest]) => {
    // Construct AST using map functions
    return rest.reduce(
      (left, [, operator, , right]) => createBinaryOp(operator, left, right),
      first,
    );
  },
);

/**
 * AST-based calculator grammar
 */
export const CalculatorGrammar = map(
  seq(_, Expression, _, not(any())),
  ([, result]) => result,
);

// =============================================================================
// 6. Direct Calculation Parser (using map functions for computation)
// =============================================================================

/**
 * Direct calculation factor
 */
export const DirectFactor: Parser<number> = choice(
  // Parenthesized expression
  map(
    seq(
      _,
      lit("("),
      _,
      (input, pos) => DirectExpression(input, pos),
      _,
      lit(")"),
      _,
    ),
    ([, , , value]) => value,
  ),
  // Signed number
  map(
    seq(_, choice(lit("+"), lit("-")), NumberParser, _),
    ([, operator, value]) => (operator === "+" ? +value : -value),
  ),
  // Regular number
  map(seq(_, NumberParser, _), ([, value]) => value),
);

/**
 * Direct calculation term - map-based multiplication/division
 */
export const DirectTerm: Parser<number> = map(
  seq(
    DirectFactor,
    star(
      choice(
        seq(_, lit("*"), _, DirectFactor),
        seq(_, lit("/"), _, DirectFactor),
        seq(_, lit("%"), _, DirectFactor),
      ),
    ),
  ),
  ([first, rest]) => {
    // Direct calculation using map functions
    return rest.reduce((left, [, operator, , right]) => {
      switch (operator) {
        case "*":
          return left * right;
        case "/":
          if (right === 0) throw new Error("Division by zero");
          return left / right;
        case "%":
          if (right === 0) throw new Error("Modulo by zero");
          return left % right;
        default:
          throw new Error(`Unknown operator: ${operator}`);
      }
    }, first);
  },
);

/**
 * Direct calculation expression - map-based addition/subtraction
 */
export const DirectExpression: Parser<number> = map(
  seq(
    DirectTerm,
    star(
      choice(seq(_, lit("+"), _, DirectTerm), seq(_, lit("-"), _, DirectTerm)),
    ),
  ),
  ([first, rest]) => {
    // Direct calculation using map functions
    return rest.reduce((left, [, operator, , right]) => {
      switch (operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        default:
          throw new Error(`Unknown operator: ${operator}`);
      }
    }, first);
  },
);

/**
 * Direct calculation grammar
 */
export const DirectCalculatorGrammar = map(
  seq(_, DirectExpression, _, not(any())),
  ([, result]) => result,
);

// =============================================================================
// 7. Utility Functions
// =============================================================================

/**
 * Parse expression string to AST
 */
export function parseToAST(input: string) {
  const result = parse(CalculatorGrammar)(input);
  if (result.success) {
    return result.val;
  }
  throw new Error(`Parse error: ${result.error.message}`);
}

/**
 * Parse expression string and calculate directly
 */
export function calculateDirect(input: string) {
  const result = parse(DirectCalculatorGrammar)(input);
  if (result.success) {
    return result.val;
  }
  throw new Error(`Parse error: ${result.error.message}`);
}

/**
 * Parse expression string and calculate via AST
 */
export function calculate(input: string) {
  const ast = parseToAST(input);
  return evaluate(ast);
}

/**
 * Convert AST to string representation (for debugging)
 */
export function astToString(node: ExpressionNode, indent = 0): string {
  const spaces = "  ".repeat(indent);

  switch (node.type) {
    case "number":
      return `${spaces}Number(${node.value})`;

    case "binaryOp":
      return [
        `${spaces}BinaryOp(${node.operator})`,
        `${spaces}  left:`,
        astToString(node.left, indent + 2),
        `${spaces}  right:`,
        astToString(node.right, indent + 2),
      ].join("\n");

    case "unaryOp":
      return [
        `${spaces}UnaryOp(${node.operator})`,
        `${spaces}  operand:`,
        astToString(node.operand, indent + 2),
      ].join("\n");

    case "group":
      return [
        `${spaces}Group`,
        `${spaces}  expression:`,
        astToString(node.expression, indent + 2),
      ].join("\n");

    default: {
      const exhaustiveCheck: never = node;
      return `${spaces}Unknown(${JSON.stringify(exhaustiveCheck)})`;
    }
  }
}

// =============================================================================
// 8. Examples and Demonstrations
// =============================================================================

export const examples = {
  // Basic arithmetic operations
  basic: [
    "1 + 2", // 3
    "3 - 1", // 2
    "2 * 3", // 6
    "6 / 2", // 3
    "7 % 3", // 1
  ],

  // Floating point numbers
  float: [
    "1.5 + 2.5", // 4
    "3.14 * 2", // 6.28
    "10.0 / 3.0", // 3.333...
  ],

  // Operator precedence
  precedence: [
    "1 + 2 * 3", // 7
    "2 * 3 + 1", // 7
    "(1 + 2) * 3", // 9
    "2 * (3 + 1)", // 8
  ],

  // Complex expressions
  complex: [
    "((1 + 2) * 3 - 4) / 2", // 2.5
    "2 * 3 + 4 * 5 - 6 / 2", // 23
    "1 + 2 * 3 + 4 * 5 + 6", // 33
  ],

  // Signed numbers
  signed: [
    "-5 + 3", // -2
    "+5 - 3", // 2
    // "-(2 + 3)",      // -5 (not currently supported)
    // "+(2 * 3)"       // 6  (not currently supported)
  ],
};

/**
 * Demo function to run all examples
 */
export function runExamples() {
  console.log("=== Arithmetic Parser Demo ===\n");

  for (const [category, exprs] of Object.entries(examples)) {
    console.log(`--- ${category} ---`);
    for (const expr of exprs) {
      try {
        const directResult = calculateDirect(expr);
        const astResult = calculate(expr);
        const ast = parseToAST(expr);

        console.log(`${expr} = ${directResult}`);
        console.log(`  Direct calc: ${directResult}`);
        console.log(`  AST calc:    ${astResult}`);
        console.log("  AST structure:");
        console.log(astToString(ast, 2));
        console.log();
      } catch (error) {
        console.log(`${expr} -> Error: ${error}`);
      }
    }
    console.log();
  }
}

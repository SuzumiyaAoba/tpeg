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
} from "@SuzumiyaAoba/core";

// =============================================================================
// 1. Basic Token Parsers
// =============================================================================

/**
 * Whitespace characters (space, tab, newline).
 *
 * This parser matches any whitespace character including spaces, tabs,
 * and newlines. It's used for handling optional whitespace in expressions.
 */
export const Whitespace = charClass(" ", "\t", "\n", "\r");

/**
 * Optional whitespace.
 *
 * This parser matches zero or more whitespace characters. It's commonly
 * used to handle optional spacing around operators and operands.
 */
export const _ = star(Whitespace);

/**
 * Single digit parser.
 *
 * Matches any single digit from 0 to 9.
 */
export const Digit = charClass(["0", "9"]);

/**
 * Integer parser.
 *
 * Parses one or more digits and converts them to a number.
 * This parser handles positive integers only.
 */
export const Integer = map(oneOrMore(Digit), (digits) =>
  Number.parseInt(digits.join(""), 10),
);

/**
 * Floating point number parser.
 *
 * Parses a decimal number with an integer part, decimal point, and fractional part.
 * The result is converted to a JavaScript number.
 */
export const Float = map(
  seq(oneOrMore(Digit), lit("."), oneOrMore(Digit)),
  ([intPart, , fracPart]) =>
    Number.parseFloat(`${intPart.join("")}.${fracPart.join("")}`),
);

/**
 * Number parser (integer or floating point).
 *
 * This parser handles both integers and floating-point numbers.
 * It tries the float parser first, then falls back to integer if that fails.
 */
export const NumberParser = choice(Float, Integer);

// =============================================================================
// 2. AST Definitions
// =============================================================================

/**
 * AST node representing a numeric literal.
 *
 * @property type - Always "number"
 * @property value - The numeric value
 */
export interface NumberNode {
  type: "number";
  value: number;
}

/**
 * AST node representing a binary operation.
 *
 * @property type - Always "binaryOp"
 * @property operator - The binary operator (+, -, *, /, %)
 * @property left - The left operand expression
 * @property right - The right operand expression
 */
export interface BinaryOpNode {
  type: "binaryOp";
  operator: "+" | "-" | "*" | "/" | "%";
  left: ExpressionNode;
  right: ExpressionNode;
}

/**
 * AST node representing a unary operation.
 *
 * @property type - Always "unaryOp"
 * @property operator - The unary operator (+ or -)
 * @property operand - The operand expression
 */
export interface UnaryOpNode {
  type: "unaryOp";
  operator: "+" | "-";
  operand: ExpressionNode;
}

/**
 * AST node representing a grouped expression.
 *
 * @property type - Always "group"
 * @property expression - The grouped expression
 */
export interface GroupNode {
  type: "group";
  expression: ExpressionNode;
}

/**
 * Union type representing all possible expression nodes.
 *
 * This type covers all AST node types that can appear in arithmetic expressions.
 */
export type ExpressionNode =
  | NumberNode
  | BinaryOpNode
  | UnaryOpNode
  | GroupNode;

// =============================================================================
// 3. AST Builder Functions
// =============================================================================

/**
 * Creates a number AST node.
 *
 * @param value - The numeric value
 * @returns A NumberNode with the specified value
 */
export const createNumber = (value: number) => ({
  type: "number" as const,
  value,
});

/**
 * Creates a binary operation AST node.
 *
 * @param operator - The binary operator
 * @param left - The left operand
 * @param right - The right operand
 * @returns A BinaryOpNode with the specified operator and operands
 */
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

/**
 * Creates a unary operation AST node.
 *
 * @param operator - The unary operator
 * @param operand - The operand
 * @returns A UnaryOpNode with the specified operator and operand
 */
export const createUnaryOp = (
  operator: UnaryOpNode["operator"],
  operand: ExpressionNode,
) => ({
  type: "unaryOp" as const,
  operator,
  operand,
});

/**
 * Creates a group AST node.
 *
 * @param expression - The grouped expression
 * @returns A GroupNode containing the specified expression
 */
export const createGroup = (expression: ExpressionNode) => ({
  type: "group" as const,
  expression,
});

// =============================================================================
// 4. Evaluator
// =============================================================================

/**
 * Evaluates an AST node to produce a numeric result.
 *
 * This function recursively evaluates AST nodes by traversing the tree
 * and performing the appropriate operations at each node.
 *
 * @param node - The AST node to evaluate
 * @returns The numeric result of evaluating the expression
 * @throws Error for division by zero, modulo by zero, or unknown node types
 *
 * @example
 * ```typescript
 * const ast = parseToAST("1 + 2 * 3");
 * const result = evaluate(ast); // Returns 7
 * ```
 */
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
 * Number literal parser.
 *
 * Parses a number and creates a NumberNode AST.
 */
export const NumberLiteral = map(seq(_, NumberParser, _), ([, value]) =>
  createNumber(value),
);

/**
 * Factor parser (number or parenthesized expression).
 *
 * This parser handles the highest precedence level in the arithmetic grammar.
 * It matches either a number literal or a parenthesized expression.
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
  seq(_, Expression, _, not(any)),
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
  seq(_, DirectExpression, _, not(any)),
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

import {
  type ParseResult,
  type Pos,
  any,
  charClass,
  choice,
  lit,
  map,
  not,
  oneOrMore,
  seq,
  star,
  parse,
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
export const Integer = map(oneOrMore(Digit), (digits: string[]) => 
  Number.parseInt(digits.join(""), 10)
);

/**
 * Floating point number
 */
export const Float = map(
  seq(
    oneOrMore(Digit),
    lit("."),
    oneOrMore(Digit)
  ),
  ([intPart, , fracPart]: [string[], string, string[]]) => 
    Number.parseFloat(`${intPart.join("")}.${fracPart.join("")}`)
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

export type ExpressionNode = NumberNode | BinaryOpNode | UnaryOpNode | GroupNode;

// =============================================================================
// 3. AST Builder Functions
// =============================================================================

export const createNumber = (value: number): NumberNode => ({
  type: "number",
  value,
});

export const createBinaryOp = (
  operator: BinaryOpNode["operator"],
  left: ExpressionNode,
  right: ExpressionNode
): BinaryOpNode => ({
  type: "binaryOp",
  operator,
  left,
  right,
});

export const createUnaryOp = (
  operator: UnaryOpNode["operator"],
  operand: ExpressionNode
): UnaryOpNode => ({
  type: "unaryOp",
  operator,
  operand,
});

export const createGroup = (expression: ExpressionNode): GroupNode => ({
  type: "group",
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
      
      switch (node.operator) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": 
          if (right === 0) throw new Error("Division by zero");
          return left / right;
        case "%": 
          if (right === 0) throw new Error("Modulo by zero");
          return left % right;
        default:
          throw new Error(`Unknown binary operator: ${node.operator as string}`);
      }
    }
    
    case "unaryOp": {
      const operand = evaluate(node.operand);
      
      switch (node.operator) {
        case "+": return +operand;
        case "-": return -operand;
        default:
          throw new Error(`Unknown unary operator: ${node.operator as string}`);
      }
    }
    
    case "group":
      return evaluate(node.expression);
    
    default: {
      const exhaustiveCheck: never = node;
      throw new Error(`Unknown node type: ${exhaustiveCheck}`);
    }
  }
}

// =============================================================================
// 5. Parser (AST Construction)
// =============================================================================

/**
 * Number literal
 */
export const NumberLiteral = map(
  seq(_, NumberParser, _),
  ([, value]: [unknown, number, unknown]) => createNumber(value)
);

/**
 * Factor (number or parenthesized expression)
 */
export function Factor(input: string, pos: Pos): ParseResult<ExpressionNode> {
  return choice(
    // Parenthesized expression
    map(
      seq(_, lit("("), _, Expression, _, lit(")"), _),
      ([,,, expr]: [unknown, string, unknown, ExpressionNode, unknown, string, unknown]) => createGroup(expr)
    ),
    // Signed number
    map(
      seq(_, choice(lit("+"), lit("-")), NumberLiteral),
      ([, operator, operand]: [unknown, string, ExpressionNode]) => createUnaryOp(operator as "+" | "-", operand)
    ),
    // Regular number
    NumberLiteral
  )(input, pos);
}

/**
 * Term (multiplication, division, modulo with map-based left associativity)
 */
export function Term(input: string, pos: Pos): ParseResult<ExpressionNode> {
  return map(
    seq(
      Factor, 
      star(
        choice(
          seq(_, lit("*"), _, Factor),
          seq(_, lit("/"), _, Factor),
          seq(_, lit("%"), _, Factor)
        )
      )
    ),
    ([first, rest]: [ExpressionNode, [unknown, string, unknown, ExpressionNode][]]) => {
      // Construct AST using map functions
      return rest.reduce((left, [, operator, , right]) => 
        createBinaryOp(operator as "*" | "/" | "%", left, right), 
        first
      );
    }
  )(input, pos);
}

/**
 * Expression (addition, subtraction with map-based left associativity)
 */
export function Expression(input: string, pos: Pos): ParseResult<ExpressionNode> {
  return map(
    seq(
      Term,
      star(
        choice(
          seq(_, lit("+"), _, Term),
          seq(_, lit("-"), _, Term)
        )
      )
    ),
    ([first, rest]: [ExpressionNode, [unknown, string, unknown, ExpressionNode][]]) => {
      // Construct AST using map functions
      return rest.reduce((left, [, operator, , right]) =>
        createBinaryOp(operator as "+" | "-", left, right),
        first
      );
    }
  )(input, pos);
}

/**
 * AST-based calculator grammar
 */
export const CalculatorGrammar = map(
  seq(_, Expression, _, not(any())),
  ([, result]: [unknown, ExpressionNode, unknown, unknown]) => result
);

// =============================================================================
// 6. Direct Calculation Parser (using map functions for computation)
// =============================================================================

/**
 * Direct calculation factor
 */
export function DirectFactor(input: string, pos: Pos): ParseResult<number> {
  return choice(
    // Parenthesized expression
    map(
      seq(_, lit("("), _, DirectExpression, _, lit(")"), _),
      ([,,, value]: [unknown, string, unknown, number, unknown, string, unknown]) => value
    ),
    // Signed number  
    map(
      seq(_, choice(lit("+"), lit("-")), NumberParser, _),
      ([, operator, value]: [unknown, string, number, unknown]) => 
        operator === "+" ? +value : -value
    ),
    // Regular number
    map(seq(_, NumberParser, _), ([, value]: [unknown, number, unknown]) => value)
  )(input, pos);
}

/**
 * Direct calculation term - map-based multiplication/division
 */
export function DirectTerm(input: string, pos: Pos): ParseResult<number> {
  return map(
    seq(
      DirectFactor,
      star(
        choice(
          seq(_, lit("*"), _, DirectFactor),
          seq(_, lit("/"), _, DirectFactor),
          seq(_, lit("%"), _, DirectFactor)
        )
      )
    ),
    ([first, rest]: [number, [unknown, string, unknown, number][]]) => {
      // Direct calculation using map functions
      return rest.reduce((left, [, operator, , right]) => {
        switch (operator) {
          case "*": return left * right;
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
    }
  )(input, pos);
}

/**
 * Direct calculation expression - map-based addition/subtraction
 */
export function DirectExpression(input: string, pos: Pos): ParseResult<number> {
  return map(
    seq(
      DirectTerm,
      star(
        choice(
          seq(_, lit("+"), _, DirectTerm),
          seq(_, lit("-"), _, DirectTerm)
        )
      )
    ),
    ([first, rest]: [number, [unknown, string, unknown, number][]]) => {
      // Direct calculation using map functions
      return rest.reduce((left, [, operator, , right]) => {
        switch (operator) {
          case "+": return left + right;
          case "-": return left - right;
          default:
            throw new Error(`Unknown operator: ${operator}`);
        }
      }, first);
    }
  )(input, pos);
}

/**
 * Direct calculation grammar
 */
export const DirectCalculatorGrammar = map(
  seq(_, DirectExpression, _, not(any())),
  ([, result]: [unknown, number, unknown, unknown]) => result
);

// =============================================================================
// 7. Utility Functions
// =============================================================================

/**
 * Parse expression string to AST
 */
export function parseToAST(input: string): ExpressionNode {
  const result = parse(CalculatorGrammar)(input);
  if (result.success) {
    return result.val;
  }
  throw new Error(`Parse error: ${result.error.message}`);
}

/**
 * Parse expression string and calculate directly
 */
export function calculateDirect(input: string): number {
  const result = parse(DirectCalculatorGrammar)(input);
  if (result.success) {
    return result.val;
  }
  throw new Error(`Parse error: ${result.error.message}`);
}

/**
 * Parse expression string and calculate via AST
 */
export function calculate(input: string): number {
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
        astToString(node.right, indent + 2)
      ].join("\n");
    
    case "unaryOp":
      return [
        `${spaces}UnaryOp(${node.operator})`,
        `${spaces}  operand:`,
        astToString(node.operand, indent + 2)
      ].join("\n");
    
    case "group":
      return [
        `${spaces}Group`,
        `${spaces}  expression:`,
        astToString(node.expression, indent + 2)
      ].join("\n");
    
    default: {
      const exhaustiveCheck: never = node;
      return `${spaces}Unknown(${exhaustiveCheck})`;
    }
  }
}

// =============================================================================
// 8. Examples and Demonstrations
// =============================================================================

export const examples = {
  // Basic arithmetic operations
  basic: [
    "1 + 2",      // 3
    "3 - 1",      // 2
    "2 * 3",      // 6
    "6 / 2",      // 3
    "7 % 3"       // 1
  ],
  
  // Floating point numbers
  float: [
    "1.5 + 2.5",    // 4
    "3.14 * 2",     // 6.28
    "10.0 / 3.0"    // 3.333...
  ],
  
  // Operator precedence
  precedence: [
    "1 + 2 * 3",     // 7
    "2 * 3 + 1",     // 7
    "(1 + 2) * 3",   // 9
    "2 * (3 + 1)"    // 8
  ],
  
  // Complex expressions
  complex: [
    "((1 + 2) * 3 - 4) / 2",   // 2.5
    "2 * 3 + 4 * 5 - 6 / 2",  // 23
    "1 + 2 * 3 + 4 * 5 + 6"   // 33
  ],
  
  // Signed numbers
  signed: [
    "-5 + 3",        // -2
    "+5 - 3"         // 2
    // "-(2 + 3)",      // -5 (not currently supported)
    // "+(2 * 3)"       // 6  (not currently supported)
  ]
};

/**
 * Demo function to run all examples
 */
export function runExamples(): void {
  console.log("=== Arithmetic Parser Demo ===\n");
  
  for (const [category, exprs] of Object.entries(examples)) {
    console.log("--- " + category + " ---");
    for (const expr of exprs) {
      try {
        const directResult = calculateDirect(expr);
        const astResult = calculate(expr);
        const ast = parseToAST(expr);
        
        console.log(`${expr} = ${directResult}`);
        console.log(`  Direct calc: ${directResult}`);
        console.log(`  AST calc:    ${astResult}`);
        console.log(`  AST structure:`);
        console.log(astToString(ast, 2));
        console.log();
      } catch (error) {
        console.log(`${expr} -> Error: ${error}`);
      }
    }
    console.log();
  }
} 
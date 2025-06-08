# TPEG Arithmetic Calculator Example

This example demonstrates how to use TPEG's `map` function to create arithmetic calculators.

## Overview

Two different parsing approaches are implemented, both leveraging TPEG's `map` functionality:

1. **Direct Calculation**: Uses `map` functions to calculate results directly during parsing
2. **AST Construction**: Uses `map` functions to build an Abstract Syntax Tree (AST), then evaluates it

## Supported Features

- **Basic arithmetic operations**: `+`, `-`, `*`, `/`, `%`
- **Floating-point numbers**: `3.14`, `2.5`
- **Operator precedence**: multiplication and division have higher precedence than addition and subtraction
- **Parenthetical grouping**: `(1 + 2) * 3`
- **Signed numbers**: `+5`, `-3`
- **Whitespace handling**: spaces are allowed anywhere

## Running the Examples

### 1. Basic Demo

```bash
bun run arith
```

Displays basic calculation examples demonstrating both approaches.

### 2. Calculate Specific Expression

```bash
bun demo.ts "1 + 2 * 3"
# Expression: 1 + 2 * 3
# Direct calc: 7
# AST calc:    7
# ✓ Both calculation methods produced the same result
```

### 3. Display AST Structure

```bash
bun demo.ts --ast "(1 + 2) * 3"
# Expression: (1 + 2) * 3
# AST Structure:
# BinaryOp(*)
#   left:
#     Group
#       expression:
#         BinaryOp(+)
#           left:
#             Number(1)
#           right:
#             Number(2)
#   right:
#     Number(3)
# 
# Result: 9
```

### 4. Interactive REPL

```bash
bun run arith:repl
```

Starts an interactive calculator where you can type expressions and see results.

### 5. Run All Examples

```bash
bun run arith:examples
```

Runs comprehensive examples from all categories.

## Map Function Examples

### Direct Calculation with `map`

```typescript
// Number parsing with map
export const Integer = map(oneOrMore(Digit), (digits: string[]) => 
  Number.parseInt(digits.join(""), 10)
);

// Direct calculation in Term parser
export function DirectTerm(input: string, pos: Pos): ParseResult<number> {
  return map(
    seq(DirectFactor, star(/* multiplication/division/modulo */)),
    ([first, rest]) => {
      // Direct calculation using map functions
      return rest.reduce((left, [, operator, , right]) => {
        switch (operator) {
          case "*": return left * right;
          case "/": return left / right;
          case "%": return left % right;
        }
      }, first);
    }
  )(input, pos);
}
```

### AST Construction with `map`

```typescript
// AST construction in Term parser
export function Term(input: string, pos: Pos): ParseResult<ExpressionNode> {
  return map(
    seq(Factor, star(/* multiplication/division/modulo */)),
    ([first, rest]) => {
      // Construct AST using map functions
      return rest.reduce((left, [, operator, , right]) => 
        createBinaryOp(operator, left, right), 
        first
      );
    }
  )(input, pos);
}
```

## Example Expressions

### Basic Operations
- `1 + 2` → 3
- `3 - 1` → 2
- `2 * 3` → 6
- `6 / 2` → 3
- `7 % 3` → 1

### Floating Point
- `1.5 + 2.5` → 4
- `3.14 * 2` → 6.28
- `10.0 / 3.0` → 3.3333333333333335

### Operator Precedence
- `1 + 2 * 3` → 7
- `2 * 3 + 1` → 7
- `(1 + 2) * 3` → 9
- `2 * (3 + 1)` → 8

### Complex Expressions
- `((1 + 2) * 3 - 4) / 2` → 2.5
- `2 * 3 + 4 * 5 - 6 / 2` → 23
- `1 + 2 * 3 + 4 * 5 + 6` → 33

### Signed Numbers
- `-5 + 3` → -2
- `+5 - 3` → 2

## Error Handling

The parser handles various error conditions:

- **Division by zero**: `1 / 0`
- **Modulo by zero**: `1 % 0`
- **Invalid syntax**: `1 +` (incomplete expression)
- **Unsupported characters**: `1 & 2`

## Key Learning Points

1. **Map functions are versatile**: They can be used both for direct computation and AST construction
2. **Left associativity**: Implemented using `reduce` in map functions
3. **Operator precedence**: Handled by parser structure (Term vs Expression)
4. **Error propagation**: Errors from map functions propagate through the parsing chain
5. **Type safety**: TypeScript ensures type correctness throughout the parsing pipeline 
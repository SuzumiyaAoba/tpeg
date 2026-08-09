# TPEG Grammar Definition Language Specification

TPEG (TypeScript Parsing Expression Grammar) is an extended PEG grammar definition language that can **transpile parser code to arbitrary programming languages** from a single grammar definition.

## Specification Scope

This specification covers:
- **PEG Grammar Definition Syntax** - Language-agnostic grammar rules
- **Semantic Actions** - Inline `{ code }` blocks attached to an alternative
- **Transform Definition Syntax** - Rule-level, typed, language-specific transforms
- **Type Inference System** - Automatic type derivation from transforms

This specification does **NOT** cover:
- Generated parser code in target languages
- Target language-specific APIs
- Runtime behavior of generated parsers
- Performance characteristics of generated code

## Design Philosophy: Language-Agnostic Grammar Definition

TPEG is built on the following design principles:

1. **Language Independence** - Grammar definitions are independent of target languages
2. **Code Generation** - Generate parsers for multiple languages from a single grammar definition
3. **Extensibility** - Easy to add support for new target languages
4. **Type Safety** - Generated code leverages each language's type system

## Type System Philosophy

TPEG separates grammar definition from type information to maintain language-agnostic grammar while enabling type-safe code generation:

1. **Grammar Purity** - Grammar definitions contain no type annotations
2. **Transform-Based Typing** - Types are specified only in transform functions
3. **Type Inference** - Automatic type inference reduces explicit type declarations
4. **Language-Native Types** - Generated code uses each language's natural type system

## Supported Target Languages

- TypeScript/JavaScript
- Python
- Go
- Rust
- Java
- C++
- Others (extensible via plugins)

## Basic Syntax Elements

### Literals
Direct string matching

```tpeg
"hello"        // String literal
'world'        // Single quotes allowed
`template`     // Template literal (for future extension)
```

### Character Classes
Character set matching

```tpeg
[a-z]          // Lowercase letters
[A-Z]          // Uppercase letters  
[0-9]          // Digits
[a-zA-Z0-9_]   // Identifier characters
[^0-9]         // Non-digits
.              // Any character
```

### Identifiers
References to defined rules

```tpeg
number         // Rule reference
identifier     // Rule reference
expression     // Rule reference
```

## Composition Operators

### Sequence
Sequential matching

```tpeg
"hello" " " "world"
number "+" number
identifier "(" arguments ")"
```

### Choice
Alternative matching

```tpeg
"true" / "false"
number / string / identifier
```

### Group
Precedence control and grouping

```tpeg
("+" / "-") number          // Ungrouped
sign:("+" / "-") number     // Labeled group
chars:(letter / digit)*     // Labeled group with repetition
```

## Repetition Operators

```tpeg
expr*          // Zero or more
expr+          // One or more
expr?          // Zero or one
expr{3}        // Exactly 3 times
expr{2,5}      // 2 to 5 times
expr{3,}       // 3 or more times
```

An *unbounded* repetition (`expr*`, `expr+`, or `expr{n,}` with no upper
bound) whose `expr` can itself match zero characters (e.g. `("a"?)*`, or
`sub*` where `sub` is itself nullable) has no well-defined meaning: the
repetition could keep "succeeding" without ever consuming input, so there is
no principled stopping point. The code generator rejects such a rule
outright, at generation time, rather than emit a parser whose behavior would
depend on incidental details of how the repetition happens to be wrapped. A
*bounded* range (`expr{2,5}`, `expr{3,3}`) has well-defined semantics
regardless of whether `expr` is nullable, since the repetition count itself
already bounds how many times it can run, and is never rejected.

## Lookahead Operators

```tpeg
&expr          // Positive lookahead (non-consuming)
!expr          // Negative lookahead (non-consuming)
```

Both forms are self-contained probes: `&expr`/`!expr` ask only "does `expr`
match here," never consuming input or otherwise affecting anything outside
themselves. A `~` cut written inside `expr` (see [Cut/Commit
Operator](#cutcommit-operator) below) is scoped to `expr`'s own attempt and
is absorbed at the lookahead's own boundary - it cannot commit whatever
choice the `&`/`!` itself happens to sit inside.

## Cut/Commit Operator

`~` may appear as one of a sequence's elements. Once everything before it has
matched, it commits to that alternative: if anything *after* it then fails,
the enclosing `/` choice does not fall back to a sibling alternative the way
ordinary PEG backtracking would. This is most useful once a short, unambiguous
prefix (a keyword, an opening delimiter) has told you which alternative was
intended - a failure past that point is a real syntax error in that
construct, not evidence you guessed the wrong alternative.

```tpeg
if_stmt = "if" ~ condition "then" body
        / while_stmt
        / expr_stmt
```

Without `~`, a typo in `condition` (e.g. a missing operand) would make the
`"if" condition "then" body` alternative fail as a whole, and the parser
would silently move on to try `while_stmt` and `expr_stmt` too - producing a
confusing error about the *last* alternative it tried, far from the actual
mistake. With `~`, a failure anywhere after `"if"` is reported immediately as
a failure in the `if` statement, since the parser is already committed to
that alternative.

`~` consumes no input and, like `&`/`!`, contributes nothing to the enclosing
sequence's capture (see the [Capture Structure Reference Table](#capture-structure-reference-table)).
It has no effect as the very last element of a sequence (there is nothing
after it left to protect), and it does not by itself affect anything outside
the sequence it appears in - in particular, a cut inside a group nested
inside a larger sequence only protects the rest of *its own* group, not
sibling elements of the outer sequence, and a cut inside `&expr`/`!expr`
only protects the rest of `expr`'s own attempt, not whatever encloses the
lookahead (see [Lookahead Operators](#lookahead-operators) above). Multiple
`~` in the same sequence are allowed but redundant: once committed, a
sequence stays committed.

## Labels and Captures

### Basic Labels
```tpeg
name:identifier          // Single capture
left:expr op:"+" right:expr  // Multiple captures
```

### Group Labels
```tpeg
sign:("+" / "-")         // Labeled choice group
chars:(letter / digit)*  // Labeled repetition group
value:("0x" [0-9a-fA-F]+) // Labeled sequence group
```

### Capture Inference
Types are automatically inferred from grammar patterns:

```tpeg
// Type inference examples:
number = digits:[0-9]+              // → captures: { digits: string }
expression = left:term right:term   // → captures: { left: T, right: T }
optional = value?                   // → captures: { value?: T }
repeated = item*                    // → captures: { item: T[] }
choice = a:first / b:second         // → captures: { a?: T1, b?: T2 }
group = sign:("+" / "-")           // → captures: { sign: string }
```

### Capture Implementation

TPEG parsers can capture parsed data in structured format using labeled expressions:

```typescript
// Basic capture usage examples
import { capture, captureSequence } from "@suzumiyaaoba/tpeg-core";

// Single value capture (pos is a plain 0-based offset, not a {line, column} object)
const nameParser = capture("name", literal("hello"));
const result = nameParser("hello", 0);
// result.val = { name: "hello" }

// Multiple value capture
const userParser = captureSequence(
  capture("firstName", literal("John")),
  literal(" "),
  capture("lastName", literal("Doe"))
);
const result = userParser("John Doe", 0);
// result.val = { firstName: "John", lastName: "Doe" }
```

### Code Generation with Captures

Labeled expressions are automatically converted to capture functions in generated code:

```tpeg
// Grammar definition
greeting = name:"hello" " " target:"world"

// Generated code - a sequence with one or more labeled elements merges
// their captures into a single object (captureSequence), rather than the
// positional tuple a plain sequence() would produce.
export const greeting = captureSequence(
  capture("name", literal("hello")),
  literal(" "),
  capture("target", literal("world"))
);
```

### Capture Structure Reference Table

| Grammar Pattern | Capture Structure | Description |
|-----------------|-------------------|-------------|
| `"literal"` | `"literal"` | String literal captures the literal type |
| `[a-z]` | `string` | Character class captures single character |
| `[a-z]+` | `string` | Character class with repetition captures concatenated string |
| `rule_name` | `T` | Rule reference captures whatever the rule returns |
| `label:pattern` | `{ label: T }` | Labeled pattern creates named capture |
| `pattern1 pattern2` | `[T1, T2]` | Unlabeled sequence captures array of elements |
| `left:pattern1 right:pattern2` | `{ left: T1, right: T2 }` | Labeled sequence creates object with named fields |
| `name:pattern1 pattern2 age:pattern3` | `{ name: T1, age: T3 }` | A sequence with *some* labeled elements still merges into an object - the unlabeled `pattern2` match is captured but has no key, so it's dropped rather than appearing positionally |
| `pattern1 / pattern2` | `T1 \| T2` | Unlabeled choice captures union type |
| `a:pattern1 / b:pattern2` | `{ a?: T1, b?: T2 }` | Labeled choice creates optional fields |
| `pattern*` | `T[]` | Unlabeled repetition captures array of matches |
| `items:pattern*` | `{ items: T[] }` | Labeled repetition captures named array |
| `pattern+` | `T[]` | One-or-more captures non-empty array |
| `pattern?` | `T?` | Unlabeled optional captures optional type |
| `value:pattern?` | `{ value?: T }` | Labeled optional creates optional field |
| `(pattern1 / pattern2)` | `T1 \| T2` | Unlabeled group captures same type as contents |
| `group:(pattern1 / pattern2)` | `{ group: T1 \| T2 }` | Labeled group creates named capture |
| `&pattern` | `null` | Positive lookahead doesn't capture |
| `!pattern` | `null` | Negative lookahead doesn't capture |
| `a ~ b` | `[T_a, T_b]` | `~` itself contributes nothing and no tuple slot - the sequence's element count (and captures, if labeled) is exactly as if `~` weren't there |

## Semantic Actions

An alternative may be followed by a `{ ... }` code block: a semantic action
that runs on a successful match and replaces the alternative's own captured
value with whatever the action returns.

```tpeg
number = digits:[0-9]+ { return parseInt(digits.join(""), 10); }
```

### Scope Inside an Action

Two things are in scope inside the action's code:

- **`$$`** - the alternative's raw captured value, exactly as it would have
  been without the action (a string, an array, a capture object, etc.).
- **Each label from the wrapped expression, destructured as its own
  variable** - if the expression is a single labeled expression, or a
  sequence containing one or more labeled elements, every label is bound by
  name. This is the same label set the sequence's own `captureSequence` merge
  produces (see the [Capture Structure Reference Table](#capture-structure-reference-table)
  above), so `$$.someLabel` and the bare variable `someLabel` are always the
  same value.

```tpeg
// Single label: `digits` is bound directly (here, $$ is { digits: [...] })
number = digits:[0-9]+ { return parseInt(digits.join(""), 10); }

// Multiple labels: both `left` and `right` are bound directly
sum = left:number "+" right:number { return left + right; }

// No labels at all: only $$ is available, holding the raw match
raw = [0-9]+ { return $$.join(""); }
```

There is no positional `$1`/`$2` capture syntax - every value an action can
see is reached by label name (or `$$` for the whole match), matching TPEG's
existing label-based capture model rather than introducing a second,
position-based one.

**Mixed labeled/unlabeled sequences:** as the
[Capture Structure Reference Table](#capture-structure-reference-table) notes,
a sequence with *some* labeled elements still merges into one object, and the
unlabeled elements' matches have no key to be merged under - so they're
dropped from `$$` entirely, not present positionally either. `name:"a" " " age:[0-9]`
gives an action `{ name, age }`, with the `" "` match unreachable.

**Labels nested under `?`/`*`/`+` are not destructured as bare variables:**
only labels that are a direct element of the action's own expression (or of
a `Sequence` that is) are bound by name. A label one level deeper, e.g.
`left:a ("+" right:b)?`, still ends up merged into `$$` when that optional
matches (the same runtime merge the table describes), so `$$.right` works -
but the bare variable `right` does not, since the action's own destructuring
only looks at the top level. Reach into `$$` by label name for these cases.

### Actions Attach Per Alternative

An action attaches to the specific alternative it follows, not to the whole
rule. Each side of a choice can have its own action, or none:

```tpeg
value = digits:[0-9]+ { return parseInt(digits.join(""), 10); }
      / "true" { return true; }
      / "false" { return false; }
```

### Actions vs. Transform Functions

TPEG has two ways to turn a parsed result into an output value: semantic
actions (this section) and [transform functions](#transform-function-specification).
They operate at different granularity and aren't meant to be combined on the
same rule:

- A **semantic action** is inline, attaches to one alternative, and has no
  declared parameter or return type - it runs as plain code in the generated
  parser's target language (currently TypeScript) as soon as that
  alternative matches.
- A **transform function** is declared separately (`transforms Name@language { ... }`),
  attaches to an entire rule by name, has an explicit typed signature, and
  returns the `Result<T>` contract described in
  [Transform Error Handling Contract](#transform-error-handling-contract) -
  including the ability to signal failure after a structural match succeeds.

Prefer a semantic action for small, inline conversions (parsing a number,
building a simple literal); prefer a transform function when the output
needs a declared type signature, needs to fail with a custom error after
matching, or is shared/generated across multiple target languages.

## Grammar Definition

### Rule Definition
```tpeg
// Basic rule
rule_name = pattern

// Documented rule
/// Four basic arithmetic operations
/// @param left Left operand
/// @param right Right operand
/// @returns Calculation result (type inferred from transform)
expression = left:term op:("+" / "-") right:term
```

### Rule-Level Annotations: `@memoize`

A rule definition may be preceded by `@memoize` (an unbounded cache) or
`@memoize: N` (a cache bounded to at most `N` tracked positions), directly
above the rule it applies to:

```tpeg
@memoize: 256
expression = left:term rest:(op:add_op right:term)*
```

This is distinct from the `@key: value` annotations in the
[Grammar Block](#grammar-block) below (`@start`, `@skip`, etc.), which are
scoped to the whole grammar, not a single rule - `@memoize` must sit directly
above the rule it names, with no other statement (including another
grammar-level annotation) between them.

Bounded memoization is a performance hint, not a semantic change: it caches a
memoized rule's parse result per input position, so re-trying the same rule
at the same offset (as ordered-choice backtracking or a shared prefix
reparse does) is an `O(1)` lookup instead of a full re-parse - see
`memoize`'s own documentation in `packages/combinator/src/logic.ts` for the
full rationale and its `maxCacheSize` option, which `@memoize: N` maps onto
directly. `@memoize` with no value leaves the cache unbounded for that rule,
matching `memoize`'s own default.

### Grammar Block
```tpeg
grammar ArithmeticCalculator {
  // Metadata
  @language_version: "1.0"
  @description: "Simple arithmetic calculator"
  @author: "TPEG Team"
  
  // Entry point
  @start: expression
  
  // Rule definitions
  expression = left:term rest:(op:add_op right:term)*
  term = left:factor rest:(op:mul_op right:factor)*
  factor = num:number / paren:"(" expr:expression ")"
  
  number = digits:[0-9]+
  add_op = "+" / "-"
  mul_op = "*" / "/"
  
  // Ignored elements
  @skip: whitespace
  whitespace = [ \t\n\r]+
}
```

## Type Inference System

TPEG automatically infers types from grammar structure and transform signatures:

### Grammar-Level Type Inference
```tpeg
// Type inference rules:
number = digits:[0-9]+           // Inferred: digits -> string (concatenated)
expression = left:term right:term // Inferred: left, right -> same type as 'term'
items = item*                    // Inferred: items -> array of 'item' type
optional = value?                // Inferred: value -> optional type
choice = "true" / "false"        // Inferred: literal string union type
sign:("+" / "-")                 // Inferred: sign -> string (from group)
```

### Transform-Driven Type Specification
Types are explicitly specified in transform function signatures, enabling:
- Multiple type interpretations of the same grammar
- Language-specific type optimizations
- Automatic type checking and inference

## Transform Function Specification

### Unified Transform Declaration Syntax
Transform functions use a language-agnostic declaration syntax with language-specific body implementation:

```tpeg
transforms TransformSetName@target_language {
  // Language-agnostic function declaration
  function_name(captures: CaptureStructure) -> ReturnType {
    // Language-specific implementation using target language syntax
  }
}
```

### Capture Structure Types
Capture structures are automatically inferred from grammar patterns:

```tpeg
// Grammar inference examples:
number = digits:[0-9]+              // → captures: { digits: string }
expression = left:term right:term   // → captures: { left: T, right: T }
optional = value?                   // → captures: { value?: T }
repeated = item*                    // → captures: { item: T[] }
choice = a:first / b:second         // → captures: { a?: T1, b?: T2 }
group = sign:("+" / "-")           // → captures: { sign: string }
```

### Error Handling Interface

#### Standardized Result Type
All transform functions must return a standardized Result type to ensure consistent error handling across languages:

```tpeg
// Language-agnostic Result type specification
type Result<T> = {
  success: boolean,
  value?: T,        // Present when success = true
  error?: string,   // Present when success = false
  position?: {      // Optional: error position information
    line: number,
    column: number,
    offset: number
  }
}
```

#### Transform Error Handling Contract
Transform functions must implement a consistent error handling pattern:

```tpeg
// All transforms return Result<T> type
transforms ExampleTransforms@target {
  rule_name(captures: CaptureType) -> Result<ReturnType> {
    // Language-specific implementation
    // Must return success/error result following the contract
  }
}
```

#### Error Categories and Handling
TPEG defines standard error categories for consistent error reporting:

```tpeg
// Standard error types
enum ErrorType {
  ParseError,      // Grammar parsing failed
  TransformError,  // Transform function failed  
  ValidationError, // Type validation failed
  RuntimeError     // Runtime execution error
}

// Enhanced Result type with error categorization
type EnhancedResult<T> = {
  success: boolean,
  value?: T,
  error?: {
    type: ErrorType,
    message: string,
    code?: string,    // Optional error code
    context?: any     // Optional additional context
  },
  position?: {
    line: number,
    column: number,
    offset: number
  }
}
```

#### Language-Specific Error Mapping
Each target language maps the standardized Result type to its native error handling:

```tpeg
// TypeScript: Native Result type
Result<T> = { success: boolean, value?: T, error?: string }

// Python: Dictionary-based result
Result<T> = {"success": bool, "value": T, "error": str}

// Go: Struct with error interface
type Result[T any] struct {
    Success bool
    Value   T
    Error   error
}

// Rust: Native Result enum integration
Result<T> = std::result::Result<T, ParseError>

// Java: Custom Result class
public class Result<T> {
    private final boolean success;
    private final T value;
    private final String error;
}
```

### Transform Examples

```tpeg
// TypeScript arithmetic evaluator
transforms ArithmeticEvaluator@typescript {
  number(captures: { digits: string }) -> Result<number> {
    const value = parseInt(captures.digits, 10);
    if (isNaN(value)) {
      return { success: false, error: 'Invalid number format' };
    }
    return { success: true, value };
  }
  
  expression(captures: { 
    left: number, 
    rest: Array<{op: string, right: number}> 
  }) -> Result<number> {
    let result = captures.left;
    for (const operation of captures.rest) {
      switch (operation.op) {
        case '+': result += operation.right; break;
        case '-': result -= operation.right; break;
        default: return { success: false, error: `Unknown operator: ${operation.op}` };
      }
    }
    return { success: true, value: result };
  }
  
  factor(captures: { num?: number, paren?: number }) -> Result<number> {
    return { success: true, value: captures.num ?? captures.paren };
  }
}

// Python arithmetic evaluator 
transforms ArithmeticEvaluator@python {
  number(captures: { digits: string }) -> Result<int> {
    try:
      value = int(captures['digits'])
      return {'success': True, 'value': value}
    except ValueError:
      return {'success': False, 'error': 'Invalid number format'}
  }
  
  expression(captures: { left: int, rest: Array<{op: string, right: int}> }) -> Result<int> {
    result = captures['left']
    for operation in captures['rest']:
      if operation['op'] == '+':
        result += operation['right']
      elif operation['op'] == '-':
        result -= operation['right']
      else:
        return {'success': False, 'error': f"Unknown operator: {operation['op']}"}
    return {'success': True, 'value': result}
  }
}

// Go arithmetic evaluator
transforms ArithmeticEvaluator@go {
  number(captures: { digits: string }) -> Result<int> {
    value, err := strconv.Atoi(captures["digits"])
    if err != nil {
      return Result{Success: false, Error: "Invalid number format"}
    }
    return Result{Success: true, Value: value}
  }
}
```

### Multiple Transform Sets from Same Grammar
The same grammar can generate completely different type systems through different transforms:

```tpeg
// Arithmetic evaluator - returns numbers
transforms ArithmeticEvaluator@typescript {
  number(captures: { digits: string }) -> Result<number> {
    return { success: true, value: parseInt(captures.digits, 10) };
  }
  
  expression(captures: { left: number, rest: Array<{op: string, right: number}> }) -> Result<number> {
    // Returns numeric result
  }
}

// AST generator - returns syntax tree nodes  
transforms ArithmeticAST@typescript {
  number(captures: { digits: string }) -> Result<NumberLiteral> {
    return { 
      success: true, 
      value: { 
        type: 'NumberLiteral', 
        value: parseInt(captures.digits, 10),
        raw: captures.digits
      }
    };
  }
  
  expression(captures: { 
    left: ASTNode, 
    rest: Array<{op: string, right: ASTNode}> 
  }) -> Result<ASTNode> {
    if (captures.rest.length === 0) {
      return { success: true, value: captures.left };
    }
    
    let result = captures.left;
    for (const operation of captures.rest) {
      result = {
        type: 'BinaryExpression',
        left: result,
        operator: operation.op,
        right: operation.right
      };
    }
    return { success: true, value: result };
  }
}
```

## Complete Arithmetic Example

### Grammar Definition
```tpeg
grammar ArithmeticCalculator {
  @version: "1.0"
  @description: "Simple four arithmetic operations calculator"
  @start: expression
  @skip: whitespace
  
  // Operator precedence is expressed through grammar hierarchy:
  // expression (lowest precedence: +, -)
  //   ↳ term (higher precedence: *, /)
  //     ↳ factor (highest precedence: numbers, parentheses)
  
  // Main expression (addition/subtraction)
  // Types inferred from transform signatures
  expression = left:term rest:(op:add_op right:term)*
  
  // Term (multiplication/division)  
  term = left:factor rest:(op:mul_op right:factor)*
  
  // Factor (number or parenthesized expression)
  factor = num:number / paren:"(" expr:expression ")"
  
  // Number literal
  number = sign:("+" / "-")? digits:[0-9]+ fraction:("." [0-9]+)?
  
  // Operators
  add_op = "+" / "-"
  mul_op = "*" / "/"
  
  // Whitespace (to be skipped)
  whitespace = [ \t\n\r]+
}
```

### Transform Definition
```tpeg
// TypeScript transforms using unified declaration syntax
transforms ArithmeticEvaluator@typescript {
  // Type signature defines the complete type system for this rule
  number(captures: { 
    sign?: string,      // Inferred as optional from grammar '?'
    digits: string,     // Inferred as string from character class repetition
    fraction?: string   // Inferred as optional string
  }) -> Result<number> { // Explicit return type drives the type system
    let base = parseInt(captures.digits, 10);
    if (captures.fraction) {
      const fracStr = '0' + captures.fraction;
      base += parseFloat(fracStr);
    }
    if (captures.sign === '-') {
      base = -base;
    }
    return { success: true, value: base };
  }
  
  expression(captures: { 
    left: number, 
    rest: Array<{op: string, right: number}> 
  }) -> Result<number> {
    let result = captures.left;
    for (const operation of captures.rest) {
      switch (operation.op) {
        case '+': result += operation.right; break;
        case '-': result -= operation.right; break;
        default: return { success: false, error: `Unknown operator: ${operation.op}` };
      }
    }
    return { success: true, value: result };
  }
  
  factor(captures: { num?: number, paren?: number }) -> Result<number> {
    if (captures.num !== undefined) {
      return { success: true, value: captures.num };
    } else if (captures.paren !== undefined) {
      return { success: true, value: captures.paren };
    }
    return { success: false, error: 'Invalid factor' };
  }
}
```

## Advanced Features

### Modular Grammar System

#### Module Declaration and Import
TPEG supports modular grammar development with explicit import/export mechanisms:

```tpeg
// base.tpeg - Base grammar module
grammar Base {
  @version: "1.0"
  @description: "Common base patterns for programming languages"
  
  // Exported rules (default: all rules are exported)
  @export: [identifier, whitespace, number, string_literal]
  
  // Core identifier pattern
  identifier = [a-zA-Z_][a-zA-Z0-9_]*
  
  // Whitespace handling
  whitespace = [ \t\n\r]+
  
  // Basic number pattern
  number = [0-9]+ ("." [0-9]+)?
  
  // String literal pattern
  string_literal = "\"" (!["] .)* "\""
  
  // Private rule (not exported)
  @private
  internal_helper = [a-z]+
}

// arithmetic.tpeg - Arithmetic grammar extending base
import "base.tpeg" as base
import "operators.tpeg" as ops

grammar Arithmetic extends base.Base {
  @version: "1.0" 
  @description: "Arithmetic expression parser"
  @start: expression
  
  // Use imported rules with module prefix
  expression = term (ops.add_op term)*
  term = factor (ops.mul_op factor)*
  factor = base.number / "(" expression ")"
  
  // Override inherited rules if needed
  @override
  number = sign:("+" / "-")? base.number
}

// operators.tpeg - Reusable operator definitions
grammar Operators {
  @export: [add_op, mul_op, cmp_op, logical_op]
  
  add_op = "+" / "-"
  mul_op = "*" / "/"
  cmp_op = "==" / "!=" / "<" / "<=" / ">" / ">="
  logical_op = "&&" / "||"
}
```

#### Module Resolution and Namespacing
```tpeg
// File: math/core.tpeg
grammar Math.Core {
  @namespace: "Math.Core"
  
  expression = term (add_op term)*
  term = factor (mul_op factor)*
  factor = number / "(" expression ")"
}

// File: math/advanced.tpeg
import "math/core.tpeg" as core
import "math/functions.tpeg" as func

grammar Math.Advanced extends core.Math.Core {
  @namespace: "Math.Advanced"
  
  // Extended expression with function calls
  @override
  factor = func.function_call / core.factor
}

// Usage with full namespace
import "math/advanced.tpeg" as math

grammar Calculator extends math.Math.Advanced {
  // Inherit all rules from Math.Advanced
}
```

#### Module Composition Patterns
```tpeg
// Mixin pattern - combining multiple grammar modules
import "literals.tpeg" as lit
import "operators.tpeg" as ops  
import "expressions.tpeg" as expr

grammar ProgrammingLanguage 
  includes lit.Literals, ops.Operators, expr.Expressions {
  
  @start: program
  
  program = statement*
  statement = assignment / expression_stmt
  assignment = lit.identifier "=" expr.expression
  expression_stmt = expr.expression ";"
}

// Selective import - only import specific rules
import "base.tpeg" { identifier, whitespace }
import "operators.tpeg" { add_op, mul_op }

grammar MiniCalc {
  expression = term (add_op term)*
  term = factor (mul_op factor)*  
  factor = number / identifier
  number = [0-9]+
}
```

#### Module Versioning and Compatibility
```tpeg
// Version specification in imports
import "base.tpeg" version "^1.0" as base
import "operators.tpeg" version ">=2.0, <3.0" as ops

grammar MyGrammar extends base.Base {
  @requires: {
    "base.tpeg": "^1.0",
    "operators.tpeg": ">=2.0, <3.0"
  }
  
  // Grammar rules...
}

// Conditional compilation based on module versions
grammar ConditionalGrammar {
  @if: base.version >= "1.5"
  enhanced_feature = complex_pattern+
  
  @else  
  enhanced_feature = simple_pattern
}
```

#### Module Dependencies and Circular Reference Prevention
```tpeg
// Module dependency declaration
grammar ModuleA {
  @dependencies: ["base.tpeg", "utils.tpeg"]
  @conflicts: ["legacy.tpeg"]  // Cannot be used together
  
  // Rules that depend on base and utils modules
}

// Circular reference detection
// File: a.tpeg
import "b.tpeg" as b
grammar A { 
  rule_a = b.rule_b some_pattern
}

// File: b.tpeg  
import "a.tpeg" as a  // ERROR: Circular dependency detected
grammar B {
  rule_b = a.rule_a another_pattern
}
```

#### Export Control and Access Modifiers
```tpeg
grammar DataTypes {
  // Public exports (default)
  @export: [string_type, number_type, boolean_type]
  
  // Explicitly public
  @public
  string_type = "\"" char* "\""
  
  // Protected - only available to extending grammars
  @protected  
  char = [^"\\] / escape_sequence
  
  // Private - internal use only
  @private
  escape_sequence = "\\" (["\\/bfnrt] / unicode_escape)
  
  // Internal - visible within module hierarchy
  @internal
  unicode_escape = "u" [0-9a-fA-F]{4}
}

// Usage restrictions
grammar Consumer extends DataTypes {
  // Can use public and protected rules
  my_string = string_type
  my_char = char        // OK: protected access
  
  // my_escape = escape_sequence  // ERROR: private access
}
```

### Labeled Choices
Choice alternatives can be labeled to enable branching in transforms

```tpeg
// Basic labeled choice
value = string:string_literal / number:number_literal / boolean:boolean_literal

// Complex labeled choice with nested captures
expression = 
  binary:(left:term op:("+" / "-") right:term) /
  unary:(op:("+" / "-") operand:factor) /
  primary:factor

// Mixed labeled and unlabeled choices
statement = 
  assignment:(target:identifier "=" value:expression) /
  call:(func:identifier "(" args:arguments? ")") /
  "return" expr:expression? /
  "break" /
  "continue"
```

### JSON Grammar with Labeled Choices

#### Grammar Definition
```tpeg
grammar JSON {
  @start: json
  @skip: whitespace
  
  json = value
  
  // Labeled choice for different value types
  value = 
    obj:object / 
    arr:array / 
    str:string / 
    num:number / 
    bool:boolean / 
    nil:"null"
  
  object = "{" pairs:(pair ("," pair)*)? "}"
  pair = key:string ":" value:value
  
  array = "[" values:(value ("," value)*)? "]"
  
  string = "\"" chars:char* "\""
  char = [^"\\] / "\\" escape:escape_char
  escape_char = "\"" / "\\" / "/" / "b" / "f" / "n" / "r" / "t" / unicode
  unicode = "u" [0-9a-fA-F]{4}
  
  number = sign:"-"? int:int_part frac:frac_part? exp:exp_part?
  int_part = "0" / [1-9][0-9]*
  frac_part = "." [0-9]+
  exp_part = ("e"/"E") sign:("+"/"-")? [0-9]+
  
  boolean = true:"true" / false:"false"
  
  whitespace = [ \t\n\r]+
}
```

## Operator Precedence and Associativity in PEG

### Grammar Hierarchy for Precedence
In PEG, operator precedence is naturally expressed through the hierarchical structure of grammar rules:

```tpeg
// Higher in the hierarchy = Lower precedence
expression = term (additive_op term)*     // Precedence level 1 (lowest)
term = factor (multiplicative_op factor)* // Precedence level 2 (higher)
factor = primary                          // Precedence level 3 (highest)
```

### Left Associativity
The repetition operator `*` naturally creates left associativity:

```
Input: "1 + 2 + 3"
Parse: left:1 rest:[(op:"+", right:2), (op:"+", right:3)]
Result: ((1 + 2) + 3) = 6
```

### Right Associativity
For right associativity, use recursive rules instead of repetition:

```tpeg
// Right-associative exponentiation
power = base:factor (op:"^" right:power)?

// Example: 2^3^4 becomes 2^(3^4)
```

### Precedence Examples

#### Arithmetic Operations
```tpeg
expression = term (("+" / "-") term)*    // Lowest: addition, subtraction
term = factor (("*" / "/") factor)*      // Higher: multiplication, division  
factor = power                           // Higher: grouping
power = primary ("^" power)?             // Highest: exponentiation (right-assoc)
primary = number / "(" expression ")"    // Atoms and parentheses
```

#### Programming Language Expressions
```tpeg
assignment = identifier "=" logical_or    // Lowest: assignment
logical_or = logical_and ("||" logical_and)*
logical_and = equality ("&&" equality)*  
equality = relational (("==" / "!=") relational)*
relational = additive (("<" / ">" / "<=" / ">=") additive)*
additive = multiplicative (("+" / "-") multiplicative)*
multiplicative = unary (("*" / "/") unary)*
unary = ("!" / "-")? primary             // Highest: unary operators
primary = identifier / literal / "(" assignment ")"
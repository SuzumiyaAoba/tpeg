# Parsing Expression Grammar (PEG): Definition and Fundamentals

## Overview

Parsing Expression Grammar (PEG) is a type of formal grammar proposed by Bryan Ford in 2004. It was developed as a more deterministic and implementation-friendly alternative to traditional Context-Free Grammar (CFG) for syntactic analysis.

## History and Background

### Development Motivation

1. **Ambiguity Problem**: CFGs can have multiple parse trees for the same string, creating implementation complexity
2. **Backtracking Necessity**: Many practical parsers require backtracking, but CFG theory doesn't adequately address this
3. **Implementation Complexity**: Parsing techniques like LR and LALR are theoretically superior but complex to implement

### Proposer and Timeline

- **Proposer**: Bryan Ford (MIT)
- **Initial Presentation**: 2004 POPL (Principles of Programming Languages)
- **Paper**: "Parsing Expression Grammars: A Recognition-Based Syntactic Foundation"

## Formal Definition

### Basic Components

PEG consists of the following elements:

1. **Set of Terminal Symbols** T
2. **Set of Non-terminal Symbols** N  
3. **Set of Parsing Expressions** P
4. **Start Symbol** S ∈ N

### Parsing Expression

A parsing expression e takes one of the following forms:

#### Primitive Expressions

1. **Empty String**: ε
2. **Terminal Symbol**: a ∈ T
3. **Non-terminal Symbol**: A ∈ N

#### Composite Expressions

1. **Sequence**: e₁ e₂ (e₁ followed by e₂)
2. **Ordered Choice**: e₁ / e₂ (try e₁, if it fails then try e₂)
3. **Zero or More**: e*
4. **And Predicate**: &e (matches e but doesn't consume input)
5. **Not Predicate**: !e (confirms e doesn't match)

### Recognition Function Definition

Recognition function R(e, x, i) for input string x and position i is defined as follows:

```
R(ε, x, i) = i
R(a, x, i) = i+1 if x[i] = a, fail otherwise
R(A, x, i) = R(P[A], x, i)
R(e₁ e₂, x, i) = let j = R(e₁, x, i) in 
                  if j ≠ fail then R(e₂, x, j) else fail
R(e₁ / e₂, x, i) = let j = R(e₁, x, i) in 
                    if j ≠ fail then j else R(e₂, x, i)
R(e*, x, i) = let j = R(e, x, i) in 
              if j ≠ fail then R(e*, x, j) else i
R(&e, x, i) = if R(e, x, i) ≠ fail then i else fail
R(!e, x, i) = if R(e, x, i) = fail then i else fail
```

## Comparison with CFG

### Key Differences

| Aspect | CFG | PEG |
|--------|-----|-----|
| Choice | Non-deterministic | Deterministic (ordered choice) |
| Ambiguity | May exist | Does not exist |
| Backtracking | Theoretically unnecessary | Explicitly supported |
| Implementation | Complex (LR, LALR, etc.) | Direct |

### Importance of Ordered Choice

CFG choice `A → α | β` is non-deterministic, while PEG ordered choice `A ← α / β`:

1. First tries α
2. Only tries β if α fails
3. This ordering eliminates ambiguity

## Left Recursion Problem

### Nature of the Problem

Left recursion causes infinite loops in PEG:

```
A ← A α / β
```

In this case, recognizing A calls A again at the same position, causing infinite recursion.

### Solution Approach

**Grammar Transformation**: Convert left recursion to right recursion

```
// Left-recursive grammar
Exp ← Exp "+" Term / Term

// Transformed
Exp ← Term ("+" Term)*
```

## Advanced Features

### Semantic Actions

Feature for performing semantic analysis during parsing:

```
Number ← [0-9]+ { parseInt($1) }
```

## Implementation Techniques

### Recursive Descent Parser

Most direct implementation method:

```typescript
function parseA(input: string, pos: number): ParseResult {
  // Implementation of A ← α / β
  let result = parseAlpha(input, pos);
  if (result.success) return result;
  return parseBeta(input, pos);
}
```

## Application Domains

### Programming Language Processing

1. **Parser Generators**: ANTLR, PEG.js, etc.
2. **DSL Implementation**: Domain-specific language processing
3. **Code Analysis**: Static analysis tools

### Data Processing

1. **Structured Data Analysis**: JSON, XML, etc.
2. **Log Analysis**: Complex log format processing
3. **Protocol Analysis**: Network protocols

## References

### Foundational Papers

1. Ford, B. (2004). "Parsing Expression Grammars: A Recognition-Based Syntactic Foundation". *POPL '04*.

2. Ford, B. (2002). "Packrat Parsing: Simple, Powerful, Lazy, Linear Time". *ICFP '02*.

### Extension Research

3. Warth, A., Douglass, J., & Millstein, T. (2008). "Packrat Parsers Can Support Left Recursion". *PEPM '08*.

4. Redziejowski, R. R. (2007). "Parsing Expression Grammar as a Primitive Recursive-Descent Parser with Backtracking". *Fundamenta Informaticae*. 
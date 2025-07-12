# Snapshot Testing

This document explains snapshot testing for the TPEG Generator.

## Overview

Snapshot tests ensure consistency of code generation using eta. They verify that the structure of generated code, imports, exports, and performance information match the expected format.

## Test Types

### 1. Basic Grammar Tests
- Simple string literals
- Character classes
- Basic combinations

### 2. Complex Grammar Tests
- Multiple rules
- Nested expressions
- Recursive rules

### 3. Optimization Tests
- Memoization application
- Performance monitoring
- Complexity analysis

### 4. Option Configuration Tests
- Type annotation presence/absence
- Import presence/absence
- Custom name prefixes

### 5. Special Expression Tests
- Quantified expressions
- Lookahead expressions
- Labeled expressions

## Snapshot Files

Snapshot files are saved in `src/__snapshots__/eta-generator.spec.ts.snap`.

### Snapshot Contents

Each test case generates the following 4 snapshots:

1. **Generated Code** (`result.code`)
   - Complete TypeScript code
   - Import statements
   - Export statements
   - Comments

2. **Import Statements** (`result.imports`)
   - Array of required imports
   - Performance monitoring imports

3. **Export Statements** (`result.exports`)
   - Array of generated parser names

4. **Performance Information** (`result.performance`)
   - Estimated complexity
   - Generation time
   - Optimization suggestions
   - Template engine

## Running Tests

```bash
# Run all tests
bun test

# Run snapshot tests only
bun test src/eta-generator.spec.ts

# Update snapshots after code changes
bun test --update-snapshots
```

## Updating Snapshots

When code generation logic is changed, snapshots need to be updated:

```bash
# Update all snapshots
bun test --update-snapshots

# Update snapshots for specific test file
bun test src/eta-generator.spec.ts --update-snapshots
```

## Adding Test Cases

When adding new test cases:

1. Add new test within the `describe("Snapshot Tests", () => {` block
2. Create appropriate grammar definition
3. Set generation options
4. Add snapshot assertions

```typescript
it("should generate consistent code for new feature", async () => {
  const grammar = createGrammarDefinition(
    "NewFeatureGrammar",
    [],
    [
      // Grammar definition
    ],
  );

  const result = await generateEtaTypeScriptParser(grammar, {
    // Option settings
  });

  // Snapshot assertions
  expect(result.code).toMatchSnapshot();
  expect(result.imports).toMatchSnapshot();
  expect(result.exports).toMatchSnapshot();
  expect(result.performance).toMatchSnapshot();
});
```

## Best Practices

1. **Uniqueness**: Each test case uses different grammar and options
2. **Comprehensiveness**: Cover all major features
3. **Clarity**: Test names clearly indicate what is being tested
4. **Maintainability**: Update snapshots carefully

## Troubleshooting

### When Snapshots Fail

1. Check if code generation logic has changed
2. Check if template files have changed
3. Update snapshots as needed

### When Snapshots Are Outdated

```bash
# Delete snapshots and regenerate
rm src/__snapshots__/eta-generator.spec.ts.snap
bun test src/eta-generator.spec.ts
```

## Related Files

- `src/eta-generator.spec.ts`: Test file
- `src/__snapshots__/eta-generator.spec.ts.snap`: Snapshot file
- `templates/`: Eta template files
- `src/eta-generator.ts`: Code generation logic 
# TPEG Self-Transpilation System - Developer Guide

This document provides comprehensive information for developers working on or contributing to the TPEG Self-Transpilation System.

## 🏗️ Architecture Overview

### System Components

The TPEG Self-Transpilation System consists of several interconnected components:

```
┌─────────────────────────────────────────────────────────────┐
│                    TPEG Self-Transpilation System           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │   Core Module   │  │ Testing Module  │  │ Optimization │ │
│  │                 │  │                 │  │   Module     │ │
│  │ • self-transpile│  │ • test-suite    │  │ • performance│ │
│  │ • types         │  │ • test-runner   │  │ • iteration  │ │
│  │ • bootstrap     │  │ • coverage      │  │ • caching    │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Error Handling  │  │   Utilities     │  │   API Layer  │ │
│  │                 │  │                 │  │              │ │
│  │ • error-types   │  │ • validation    │  │ • unified-api│ │
│  │ • recovery      │  │ • reporting     │  │ • quick-start│ │
│  │ • diagnostics   │  │ • monitoring    │  │ • workflows  │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Input Grammar → Parse → Validate → Generate → Test → Output
      ↓           ↓        ↓         ↓       ↓       ↓
   Grammar     AST    Validated   TypeScript Generated Test
   Source      Tree     AST       Parser Code Parser  Reports
```

### Module Dependencies

```
api.ts
├── self-transpile.ts (core)
├── comprehensive-test-suite.ts
│   ├── test-runner.ts
│   └── test-coverage.ts
├── performance-optimization.ts
│   └── iteration-optimization.ts
├── error-handling.ts
└── bootstrap-validation.ts
```

## 🔧 Development Environment Setup

### Prerequisites

- **Node.js**: 18.0.0 or higher
- **Bun**: Latest version (recommended runtime)
- **TypeScript**: 5.0.0 or higher
- **Git**: For version control

### Installation

```bash
# Clone the repository
git clone https://github.com/SuzumiyaAoba/tpeg.git
cd tpeg/packages/self-transpile

# Install dependencies
bun install

# Build the project
bun run build

# Run tests
bun test

# Run type checking
bun run typecheck
```

### Development Scripts

```bash
# Development
bun run dev              # Start development mode
bun run watch            # Watch mode for auto-rebuild
bun run typecheck        # TypeScript type checking
bun run lint             # Run linter
bun run format           # Format code

# Testing
bun test                 # Run all tests
bun run test:unit        # Unit tests only
bun run test:integration # Integration tests only
bun run test:coverage    # Tests with coverage
bun run test:watch       # Watch mode for tests

# Building
bun run build            # Production build
bun run build:dev        # Development build
bun run clean            # Clean build artifacts

# Quality
bun run qa               # Run all quality checks
bun run docs:generate    # Generate documentation
bun run docs:serve       # Serve documentation locally
```

## 📁 Project Structure

```
packages/self-transpile/
├── src/                                    # Source code
│   ├── api.ts                             # Unified API exports
│   ├── types.ts                           # Type definitions
│   ├── self-transpile.ts                  # Core transpilation logic
│   ├── comprehensive-test-suite.ts        # Testing framework
│   ├── test-runner.ts                     # CLI test runner
│   ├── test-coverage.ts                   # Coverage analysis
│   ├── performance-optimization.ts        # Performance optimizations
│   ├── iteration-optimization.ts          # Batch processing
│   ├── error-handling.ts                  # Error management
│   ├── bootstrap-validation.ts            # Bootstrap validation
│   └── test-*.ts                          # Test files
├── docs/                                   # Documentation
│   ├── api/                               # API documentation
│   ├── guides/                            # User guides
│   └── examples/                          # Code examples
├── tests/                                  # Additional test files
├── benchmarks/                            # Performance benchmarks
├── examples/                              # Example grammars
├── package.json                           # Package configuration
├── tsconfig.json                          # TypeScript configuration
├── README.md                              # User documentation
├── DEVELOPMENT.md                         # This file
└── CHANGELOG.md                           # Version history
```

## 🧪 Testing Strategy

### Test Categories

1. **Unit Tests** (`*.spec.ts`)
   - Individual function testing
   - Isolated component testing
   - Mock dependencies

2. **Integration Tests** (`*.integration.spec.ts`)
   - Component interaction testing
   - End-to-end workflows
   - Real dependency testing

3. **Performance Tests** (`*.perf.spec.ts`)
   - Benchmark testing
   - Memory usage testing
   - Optimization validation

4. **System Tests** (`*.system.spec.ts`)
   - Complete system testing
   - User scenario testing
   - Real-world use cases

### Test Implementation Guidelines

#### Writing Unit Tests

```typescript
// Good unit test example
describe('selfTranspile', () => {
  it('should transpile simple grammar successfully', async () => {
    // Arrange
    const grammarSource = `grammar Test { rule = "test" }`;
    const expectedResult = expect.objectContaining({
      success: true,
      code: expect.stringContaining('export const rule')
    });

    // Act
    const result = await selfTranspile(grammarSource);

    // Assert
    expect(result).toEqual(expectedResult);
  });

  it('should handle invalid grammar gracefully', async () => {
    // Arrange
    const invalidGrammar = `invalid grammar syntax`;

    // Act & Assert
    await expect(selfTranspile(invalidGrammar)).rejects.toThrow();
  });
});
```

#### Writing Integration Tests

```typescript
describe('Complete Workflow Integration', () => {
  let system: TPEGSelfTranspilationSystem;

  beforeEach(() => {
    system = createTPEGSystem({
      enableOptimization: true,
      enableTesting: true,
      enableCoverage: true
    });
  });

  it('should execute complete workflow successfully', async () => {
    const grammarSource = readTestGrammar('calculator.tpeg');
    
    const result = await system.runCompleteWorkflow(grammarSource);
    
    expect(result.success).toBe(true);
    expect(result.transpilation?.success).toBe(true);
    expect(result.testing?.passedTests).toBeGreaterThan(0);
    expect(result.coverage?.summary.grade).not.toBe('F');
  });
});
```

### Running Tests

```bash
# Run specific test files
bun test src/self-transpile.spec.ts

# Run tests with coverage
bun run test:coverage

# Run tests in watch mode
bun run test:watch

# Run performance tests
bun run test:perf

# Run comprehensive test suite
bun run src/test-comprehensive-suite.ts
```

## 🚀 Performance Optimization

### Optimization Techniques

1. **Caching Strategy**
   ```typescript
   class LRUCache<K, V> {
     private cache = new Map<K, V>();
     
     get(key: K): V | undefined {
       if (this.cache.has(key)) {
         const value = this.cache.get(key)!;
         this.cache.delete(key);
         this.cache.set(key, value);
         return value;
       }
     }
   }
   ```

2. **Memory Pooling**
   ```typescript
   class MemoryPool<T> {
     private pool: T[] = [];
     
     acquire(): T {
       return this.pool.pop() || this.create();
     }
     
     release(item: T): void {
       this.reset(item);
       this.pool.push(item);
     }
   }
   ```

3. **String Builder Optimization**
   ```typescript
   class OptimizedStringBuilder {
     private chunks: string[] = [];
     
     append(str: string): this {
       this.chunks.push(str);
       return this;
     }
     
     toString(): string {
       return this.chunks.join('');
     }
   }
   ```

### Performance Monitoring

```typescript
// Enable performance monitoring
const system = createTPEGSystem({
  enablePerformanceMonitoring: true
});

// Monitor specific operations
const startTime = performance.now();
const result = await system.transpile(grammarSource);
const endTime = performance.now();

console.log(`Transpilation took ${endTime - startTime}ms`);
console.log(`Memory usage: ${process.memoryUsage().heapUsed / 1024 / 1024}MB`);
```

### Benchmarking

```bash
# Run performance benchmarks
bun run src/performance-benchmark.ts

# Run iteration optimization benchmarks
bun run src/test-iteration-optimization.ts

# Compare baseline vs optimized performance
bun run src/test-performance-optimization.ts
```

## 🐛 Debugging

### Debug Configuration

```typescript
// Enable debug mode
process.env.DEBUG = "tpeg:*";

// Verbose logging
const system = createTPEGSystem({
  verbose: true,
  enableErrorHandling: true
});

// Debug specific components
process.env.DEBUG = "tpeg:transpile,tpeg:optimization";
```

### Common Debug Scenarios

#### Memory Leaks

```typescript
// Monitor memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  console.log(`Memory: ${usage.heapUsed / 1024 / 1024}MB`);
}, 1000);

// Force garbage collection (if available)
if (global.gc) {
  global.gc();
}
```

#### Performance Issues

```typescript
// Profile specific operations
console.time('transpilation');
const result = await selfTranspile(grammarSource);
console.timeEnd('transpilation');

// Memory profiling
const memBefore = process.memoryUsage().heapUsed;
await performOperation();
const memAfter = process.memoryUsage().heapUsed;
console.log(`Memory delta: ${(memAfter - memBefore) / 1024 / 1024}MB`);
```

#### Error Debugging

```typescript
// Enable detailed error information
const result = await withErrorHandling(
  () => selfTranspile(grammarSource),
  {
    enableDiagnostics: true,
    enableRecovery: true,
    logLevel: "detailed"
  }
);

if (!result.success) {
  console.log("Errors:", result.errors);
  console.log("Diagnostics:", result.diagnostics);
}
```

## 🔄 Development Workflow

### Branch Strategy

- `master`: Production-ready code
- `develop`: Integration branch for features
- `feature/*`: Individual feature development
- `bugfix/*`: Bug fixes
- `hotfix/*`: Critical production fixes

### Commit Convention

```
feat: add new optimization technique
fix: resolve memory leak in caching system
docs: update API documentation
test: add comprehensive test suite
perf: improve iteration optimization performance
refactor: restructure error handling system
style: fix code formatting issues
chore: update dependencies
```

### Pull Request Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/new-optimization
   ```

2. **Implement Changes**
   - Write code following style guidelines
   - Add comprehensive tests
   - Update documentation

3. **Test Thoroughly**
   ```bash
   bun run qa                    # All quality checks
   bun run test:coverage         # Ensure coverage
   bun run test:integration      # Integration tests
   ```

4. **Submit Pull Request**
   - Clear description of changes
   - Reference related issues
   - Include test results

5. **Code Review**
   - Address reviewer feedback
   - Ensure CI passes
   - Update documentation if needed

### Release Process

1. **Version Bump**
   ```bash
   npm version patch|minor|major
   ```

2. **Update Changelog**
   ```markdown
   ## [1.2.0] - 2024-01-15
   ### Added
   - New optimization features
   ### Fixed
   - Memory leak issues
   ### Changed
   - API improvements
   ```

3. **Build and Test**
   ```bash
   bun run build
   bun run test:all
   bun run test:integration
   ```

4. **Publish**
   ```bash
   npm publish
   git push --tags
   ```

## 🔍 Code Quality

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### Linting Rules

```json
{
  "@typescript-eslint/no-unused-vars": "error",
  "@typescript-eslint/explicit-function-return-type": "warn",
  "@typescript-eslint/no-explicit-any": "warn",
  "prefer-const": "error",
  "no-var": "error"
}
```

### Code Style Guidelines

1. **Function Naming**
   ```typescript
   // Good
   async function transpileGrammar(source: string): Promise<Result>
   
   // Bad
   async function tg(s: string): Promise<any>
   ```

2. **Error Handling**
   ```typescript
   // Good
   try {
     const result = await operation();
     return { success: true, data: result };
   } catch (error) {
     return { 
       success: false, 
       error: error instanceof Error ? error.message : String(error) 
     };
   }
   ```

3. **Type Definitions**
   ```typescript
   // Good
   interface TranspileConfig {
     targetLanguage: 'typescript' | 'javascript';
     optimize: boolean;
     includeTypes?: boolean;
   }
   
   // Bad
   interface Config {
     lang: string;
     opt: boolean;
     types?: any;
   }
   ```

## 📊 Monitoring and Analytics

### Performance Metrics

```typescript
interface PerformanceMetrics {
  transpilationTime: number;
  memoryUsage: number;
  codeLength: number;
  optimizationGain: number;
  testCoverage: number;
  errorRate: number;
}
```

### Logging

```typescript
import { createLogger } from './utils/logger';

const logger = createLogger('transpilation');

logger.info('Starting transpilation', { grammarSize: source.length });
logger.debug('Parsing AST', { nodeCount: ast.nodes.length });
logger.warn('Performance degradation detected', { duration: elapsed });
logger.error('Transpilation failed', { error: error.message });
```

### Health Checks

```typescript
export function healthCheck(): HealthStatus {
  return {
    status: 'healthy',
    version: pkg.version,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    tests: {
      passing: lastTestRun.passed,
      total: lastTestRun.total,
      coverage: lastTestRun.coverage
    }
  };
}
```

## 🤝 Contributing Guidelines

### Getting Started

1. **Fork the Repository**
2. **Set Up Development Environment**
3. **Find an Issue** or propose a new feature
4. **Create Feature Branch**
5. **Implement Changes**
6. **Add Tests**
7. **Update Documentation**
8. **Submit Pull Request**

### Contribution Types

- **Bug Fixes**: Fix reported issues
- **Features**: Add new functionality
- **Performance**: Optimize existing code
- **Documentation**: Improve docs and examples
- **Tests**: Add or improve test coverage
- **Refactoring**: Improve code structure

### Review Criteria

- Code quality and style
- Test coverage
- Documentation updates
- Performance impact
- Backward compatibility
- Security considerations

## 🔒 Security Considerations

### Input Validation

```typescript
function validateGrammarInput(source: string): ValidationResult {
  if (typeof source !== 'string') {
    return { valid: false, error: 'Grammar source must be a string' };
  }
  
  if (source.length > MAX_GRAMMAR_SIZE) {
    return { valid: false, error: 'Grammar source too large' };
  }
  
  if (source.includes('<script>')) {
    return { valid: false, error: 'Potentially unsafe content detected' };
  }
  
  return { valid: true };
}
```

### Error Sanitization

```typescript
function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Remove sensitive information from error messages
    return error.message.replace(/\/[^\/\s]+/g, '[PATH]');
  }
  return 'Unknown error occurred';
}
```

### Safe Code Generation

```typescript
function generateSafeCode(ast: AST): string {
  // Validate AST nodes
  validateAST(ast);
  
  // Generate code with proper escaping
  const code = generateCode(ast, { escapeHTML: true });
  
  // Validate generated code
  validateGeneratedCode(code);
  
  return code;
}
```

## 📈 Roadmap

### Short-term Goals (Next Release)

- [ ] Improve error message quality
- [ ] Add more optimization techniques
- [ ] Enhance test coverage
- [ ] Performance improvements

### Medium-term Goals (Next Quarter)

- [ ] Plugin system for extensibility
- [ ] Web-based grammar editor
- [ ] CLI tool improvements
- [ ] Additional language targets

### Long-term Goals (Next Year)

- [ ] Language server protocol support
- [ ] Visual grammar debugging
- [ ] Cloud-based transpilation service
- [ ] Integration with popular IDEs

## 🆘 Support

### Getting Help

- **GitHub Issues**: Report bugs or request features
- **Discussions**: Ask questions and share ideas
- **Documentation**: Check existing docs and guides
- **Examples**: Look at example implementations

### Common Issues

1. **Build Failures**: Check Node.js version and dependencies
2. **Test Failures**: Ensure all dependencies are installed
3. **Performance Issues**: Enable optimization features
4. **Memory Issues**: Configure memory limits appropriately

### Debugging Tips

1. **Enable verbose logging** for detailed information
2. **Use performance profiling** for optimization
3. **Check memory usage** for leak detection
4. **Validate inputs** before processing
5. **Test with minimal examples** to isolate issues

---

**Happy developing! 🚀**

For more information, see [README.md](./README.md) or visit our [GitHub repository](https://github.com/SuzumiyaAoba/tpeg). 
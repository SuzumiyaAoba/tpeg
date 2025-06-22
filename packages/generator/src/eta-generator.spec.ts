/**
 * Tests for Eta Template Engine Based Code Generator
 */

import { describe, it, expect } from 'bun:test';
import { EtaTPEGCodeGenerator, generateEtaTypeScriptParser } from './eta-generator';

// Import test utilities from core
import type { GrammarDefinition, RuleDefinition } from './types';

// Simple test helper functions
function createGrammarDefinition(name: string, annotations: any[], rules: RuleDefinition[]): GrammarDefinition {
  return {
    type: 'GrammarDefinition',
    name,
    annotations,
    rules,
  };
}

function createRuleDefinition(name: string, pattern: any): RuleDefinition {
  return {
    type: 'RuleDefinition',
    name,
    pattern,
  };
}

function createStringLiteral(value: string) {
  return {
    type: 'StringLiteral',
    value,
  };
}

function createCharacterClass(ranges: any[], negated: boolean) {
  return {
    type: 'CharacterClass',
    ranges,
    negated,
  };
}

function createCharRange(start: string, end: string) {
  return { start, end };
}

function createSequence(elements: any[]) {
  return {
    type: 'Sequence',
    elements,
  };
}

function createChoice(alternatives: any[]) {
  return {
    type: 'Choice',
    alternatives,
  };
}

function createStar(expression: any) {
  return {
    type: 'Star',
    expression,
  };
}

function createPlus(expression: any) {
  return {
    type: 'Plus',
    expression,
  };
}

function createOptional(expression: any) {
  return {
    type: 'Optional',
    expression,
  };
}

function createIdentifier(name: string) {
  return {
    type: 'Identifier',
    name,
  };
}

describe('EtaTPEGCodeGenerator', () => {
  describe('Basic Code Generation', () => {
    it('should generate simple rule with string literal', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition('hello', createStringLiteral('world')),
      ]);

      const generator = new EtaTPEGCodeGenerator({
        language: 'typescript',
        namePrefix: 'test_',
        includeTypes: true,
      });

      const result = await generator.generateGrammar(grammar);

      expect(result.code).toContain('import type { Parser } from "tpeg-core";');
      expect(result.code).toContain('import { literal } from "tpeg-core";');
      expect(result.code).toContain('export const test_hello: Parser<any> = literal("world");');
      expect(result.performance.templateEngine).toBe('eta');
    });

    it('should generate rule with character class', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition(
          'letter',
          createCharacterClass([createCharRange('a', 'z')], false),
        ),
      ]);

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: 'test_',
        includeTypes: true,
      });

      expect(result.code).toContain('charClass');
      expect(result.code).toContain('export const test_letter: Parser<any>');
      expect(result.code).toContain('{ from: "a", to: "z" }');
    });

    it('should generate multiple rules', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition('hello', createStringLiteral('hello')),
        createRuleDefinition('world', createStringLiteral('world')),
        createRuleDefinition(
          'greeting',
          createSequence([
            createIdentifier('hello'),
            createStringLiteral(' '),
            createIdentifier('world'),
          ]),
        ),
      ]);

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: 'test_',
        includeTypes: true,
      });

      expect(result.code).toContain('export const test_hello: Parser<any>');
      expect(result.code).toContain('export const test_world: Parser<any>');
      expect(result.code).toContain('export const test_greeting: Parser<any>');
      expect(result.code).toContain('sequence(test_hello, literal(" "), test_world)');
      expect(result.exports).toEqual(['test_hello', 'test_world', 'test_greeting']);
    });
  });

  describe('Advanced Expressions', () => {
    it('should generate sequence expressions', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition(
          'sequence',
          createSequence([
            createStringLiteral('a'),
            createStringLiteral('b'),
            createStringLiteral('c'),
          ]),
        ),
      ]);

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain('sequence(literal("a"), literal("b"), literal("c"))');
    });

    it('should generate choice expressions', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition(
          'choice',
          createChoice([
            createStringLiteral('true'),
            createStringLiteral('false'),
          ]),
        ),
      ]);

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain('choice(literal("true"), literal("false"))');
    });

    it('should generate repetition expressions', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition('star', createStar(createStringLiteral('a'))),
        createRuleDefinition('plus', createPlus(createStringLiteral('b'))),
        createRuleDefinition('optional', createOptional(createStringLiteral('c'))),
      ]);

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain('zeroOrMore(literal("a"))');
      expect(result.code).toContain('oneOrMore(literal("b"))');
      expect(result.code).toContain('optional(literal("c"))');
    });
  });

  describe('Type Generation Options', () => {
    it('should generate without types when includeTypes is false', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition('hello', createStringLiteral('world')),
      ]);

      const result = await generateEtaTypeScriptParser(grammar, {
        includeTypes: false,
      });

      expect(result.code).toContain('export const hello = literal("world");');
      expect(result.code).not.toContain(': Parser<any>');
    });

    it('should generate with custom name prefix', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition('rule', createStringLiteral('value')),
      ]);

      const result = await generateEtaTypeScriptParser(grammar, {
        namePrefix: 'custom_',
      });

      expect(result.code).toContain('export const custom_rule');
    });

    it('should skip imports when includeImports is false', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition('hello', createStringLiteral('world')),
      ]);

      const result = await generateEtaTypeScriptParser(grammar, {
        includeImports: false,
      });

      expect(result.code).not.toContain('import');
      expect(result.code).toContain('export const hello');
    });
  });

  describe('Performance Analysis', () => {
    it('should include performance metadata', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition('simple', createStringLiteral('hello')),
      ]);

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.performance).toBeDefined();
      expect(result.performance.templateEngine).toBe('eta');
      expect(result.performance.estimatedComplexity).toBe('low');
      expect(typeof result.performance.generationTime).toBe('number');
      expect(Array.isArray(result.performance.optimizationSuggestions)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty grammar', async () => {
      const grammar = createGrammarDefinition('EmptyGrammar', [], []);

      const result = await generateEtaTypeScriptParser(grammar);

      expect(result.code).toContain('import type { Parser }');
      expect(result.exports).toEqual([]);
    });

    it('should handle invalid template directory gracefully', async () => {
      const grammar = createGrammarDefinition('TestGrammar', [], [
        createRuleDefinition('rule', createStringLiteral('value')),
      ]);

      const generator = new EtaTPEGCodeGenerator({
        language: 'typescript',
        templatesDir: '/nonexistent/path',
        cache: false,
      });

      // Should still attempt to generate, even if templates are missing
      // The actual error handling depends on Eta's behavior
      await expect(generator.generateGrammar(grammar)).rejects.toThrow();
    });
  });
});
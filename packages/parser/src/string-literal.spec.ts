/**
 * String Literal Parser Tests
 */

import { describe, it, expect } from 'bun:test';
import { stringLiteral } from './string-literal';

describe('stringLiteral', () => {
  const parser = stringLiteral();
  const pos = { offset: 0, line: 1, column: 1 };

  describe('double-quoted strings', () => {
    it('should parse simple double-quoted strings', () => {
      const result = parser('"hello"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe('StringLiteral');
        expect(result.val.value).toBe('hello');
        expect(result.val.quote).toBe('"');
      }
    });

    it('should parse empty double-quoted strings', () => {
      const result = parser('""', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('');
        expect(result.val.quote).toBe('"');
      }
    });

    it('should parse double-quoted strings with escape sequences', () => {
      const result = parser('"hello\\nworld"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('hello\nworld');
      }
    });

    it('should parse double-quoted strings with escaped quotes', () => {
      const result = parser('"say \\"hello\\""', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('say "hello"');
      }
    });
  });

  describe('single-quoted strings', () => {
    it('should parse simple single-quoted strings', () => {
      const result = parser("'world'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe('StringLiteral');
        expect(result.val.value).toBe('world');
        expect(result.val.quote).toBe("'");
      }
    });

    it('should parse single-quoted strings with escape sequences', () => {
      const result = parser("'hello\\tworld'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('hello\tworld');
      }
    });

    it('should parse single-quoted strings with escaped quotes', () => {
      const result = parser("'don\\'t'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("don't");
      }
    });
  });

  describe('template literals', () => {
    it('should parse simple template literals', () => {
      const result = parser('`template`', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe('StringLiteral');
        expect(result.val.value).toBe('template');
        expect(result.val.quote).toBe('`');
      }
    });

    it('should parse template literals with escape sequences', () => {
      const result = parser('`line1\\rline2`', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('line1\rline2');
      }
    });

    it('should parse template literals with escaped backticks', () => {
      const result = parser('`code: \\`hello\\``', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('code: `hello`');
      }
    });
  });

  describe('error cases', () => {
    it('should fail on unclosed double quotes', () => {
      const result = parser('"unclosed', pos);
      expect(result.success).toBe(false);
    });

    it('should fail on unclosed single quotes', () => {
      const result = parser("'unclosed", pos);
      expect(result.success).toBe(false);
    });

    it('should fail on unclosed template literals', () => {
      const result = parser('`unclosed', pos);
      expect(result.success).toBe(false);
    });

    it('should fail on empty input', () => {
      const result = parser('', pos);
      expect(result.success).toBe(false);
    });
  });
}); 
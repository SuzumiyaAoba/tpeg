/**
 * String Literal Parser Tests
 */

import { describe, it, expect } from 'bun:test';
import { stringLiteral } from './string-literal';

const pos = { offset: 0, line: 1, column: 1 };

describe('stringLiteral', () => {
  const parser = stringLiteral();

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
      const result = parser('"hello\\nworld\\t"', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('hello\nworld\t');
        expect(result.val.quote).toBe('"');
      }
    });

    it('should parse double-quoted strings with escaped quotes', () => {
      const result = parser('"say \\"hello\\""', pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('say "hello"');
        expect(result.val.quote).toBe('"');
      }
    });
  });

  describe('single-quoted strings', () => {
    it('should parse simple single-quoted strings', () => {
      const result = parser("'hello'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.type).toBe('StringLiteral');
        expect(result.val.value).toBe('hello');
        expect(result.val.quote).toBe("'");
      }
    });

    it('should parse single-quoted strings with escape sequences', () => {
      const result = parser("'hello\\nworld'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe('hello\nworld');
        expect(result.val.quote).toBe("'");
      }
    });

    it('should parse single-quoted strings with escaped quotes', () => {
      const result = parser("'can\\'t'", pos);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.val.value).toBe("can't");
        expect(result.val.quote).toBe("'");
      }
    });
  });

  describe('error cases', () => {
    it('should fail on unclosed double quotes', () => {
      const result = parser('"hello', pos);
      expect(result.success).toBe(false);
    });

    it('should fail on unclosed single quotes', () => {
      const result = parser("'hello", pos);
      expect(result.success).toBe(false);
    });

    it('should fail on empty input', () => {
      const result = parser('', pos);
      expect(result.success).toBe(false);
    });
  });
}); 
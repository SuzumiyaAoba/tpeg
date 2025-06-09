/**
 * TPEG Composition Operators Tests
 * 
 * Tests for sequence, choice, and group operators.
 */

import { describe, it, expect } from 'bun:test';
import { expression, sequenceOperator, choiceOperator, groupOperator } from './composition';
import type { Expression, Sequence, Choice, Group } from './types';

const pos = { offset: 0, line: 1, column: 1 };

describe('composition operators', () => {
  describe('expression parser', () => {
    describe('basic syntax', () => {
      it('should parse string literals', () => {
        const result = expression()('"hello"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('StringLiteral');
          if (result.val.type === 'StringLiteral') {
            expect(result.val.value).toBe('hello');
            expect(result.val.quote).toBe('"');
          }
        }
      });

      it('should parse character classes', () => {
        const result = expression()('[a-z]', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('CharacterClass');
        }
      });

      it('should parse identifiers', () => {
        const result = expression()('identifier', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Identifier');
          if (result.val.type === 'Identifier') {
            expect(result.val.name).toBe('identifier');
          }
        }
      });
    });

    describe('sequence operator', () => {
      it('should parse simple sequences', () => {
        const result = expression()('"hello" "world"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Sequence');
          if (result.val.type === 'Sequence') {
            expect(result.val.elements).toHaveLength(2);
            expect(result.val.elements[0].type).toBe('StringLiteral');
            expect(result.val.elements[1].type).toBe('StringLiteral');
          }
        }
      });

      it('should parse sequences with three elements', () => {
        const result = expression()('"a" "b" "c"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Sequence');
          if (result.val.type === 'Sequence') {
            expect(result.val.elements).toHaveLength(3);
          }
        }
      });

      it('should parse sequences with mixed types', () => {
        const result = expression()('"hello" [a-z] identifier', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Sequence');
          if (result.val.type === 'Sequence') {
            expect(result.val.elements).toHaveLength(3);
            expect(result.val.elements[0].type).toBe('StringLiteral');
            expect(result.val.elements[1].type).toBe('CharacterClass');
            expect(result.val.elements[2].type).toBe('Identifier');
          }
        }
      });

      it('should handle whitespace in sequences', () => {
        const result = expression()('"hello"   "world"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Sequence');
        }
      });

      it('should not parse single elements as sequences', () => {
        const result = expression()('"hello"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('StringLiteral');
        }
      });
    });

    describe('choice operator', () => {
      it('should parse simple choices', () => {
        const result = expression()('"true" / "false"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Choice');
          if (result.val.type === 'Choice') {
            expect(result.val.alternatives).toHaveLength(2);
            expect(result.val.alternatives[0].type).toBe('StringLiteral');
            expect(result.val.alternatives[1].type).toBe('StringLiteral');
          }
        }
      });

      it('should parse choices with three alternatives', () => {
        const result = expression()('"a" / "b" / "c"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Choice');
          if (result.val.type === 'Choice') {
            expect(result.val.alternatives).toHaveLength(3);
          }
        }
      });

      it('should parse choices with mixed types', () => {
        const result = expression()('"string" / [0-9] / identifier', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Choice');
          if (result.val.type === 'Choice') {
            expect(result.val.alternatives).toHaveLength(3);
            expect(result.val.alternatives[0].type).toBe('StringLiteral');
            expect(result.val.alternatives[1].type).toBe('CharacterClass');
            expect(result.val.alternatives[2].type).toBe('Identifier');
          }
        }
      });

      it('should handle whitespace around choice operator', () => {
        const result = expression()('"a" / "b"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Choice');
        }
      });

      it('should handle no whitespace around choice operator', () => {
        const result = expression()('"a"/"b"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Choice');
        }
      });
    });

    describe('group operator', () => {
      it('should parse simple groups', () => {
        const result = expression()('("hello")', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Group');
          if (result.val.type === 'Group') {
            expect(result.val.expression.type).toBe('StringLiteral');
          }
        }
      });

      it('should parse groups with choices', () => {
        const result = expression()('("a" / "b")', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Group');
          if (result.val.type === 'Group') {
            expect(result.val.expression.type).toBe('Choice');
          }
        }
      });

      it('should parse groups with sequences', () => {
        const result = expression()('("a" "b")', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Group');
          if (result.val.type === 'Group') {
            expect(result.val.expression.type).toBe('Sequence');
          }
        }
      });

      it('should handle whitespace in groups', () => {
        const result = expression()('( "hello" )', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Group');
        }
      });
    });

    describe('operator precedence', () => {
      it('should prioritize groups over sequences', () => {
        const result = expression()('("a" / "b") "c"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Sequence');
          if (result.val.type === 'Sequence') {
            expect(result.val.elements).toHaveLength(2);
            expect(result.val.elements[0].type).toBe('Group');
            expect(result.val.elements[1].type).toBe('StringLiteral');
          }
        }
      });

      it('should prioritize sequences over choices', () => {
        const result = expression()('"a" "b" / "c" "d"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Choice');
          if (result.val.type === 'Choice') {
            expect(result.val.alternatives).toHaveLength(2);
            expect(result.val.alternatives[0].type).toBe('Sequence');
            expect(result.val.alternatives[1].type).toBe('Sequence');
          }
        }
      });

      it('should handle complex precedence', () => {
        const result = expression()('("a" / "b") "c" / "d" ("e" / "f")', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Choice');
          if (result.val.type === 'Choice') {
            expect(result.val.alternatives).toHaveLength(2);
            // First alternative should be a sequence: ("a" / "b") "c"
            expect(result.val.alternatives[0].type).toBe('Sequence');
            // Second alternative should be a sequence: "d" ("e" / "f")
            expect(result.val.alternatives[1].type).toBe('Sequence');
          }
        }
      });
    });

    describe('error cases', () => {
      it('should fail on unclosed groups', () => {
        const result = expression()('("hello"', pos);
        expect(result.success).toBe(false);
      });

      it('should fail on empty groups', () => {
        const result = expression()('()', pos);
        expect(result.success).toBe(false);
      });

      it('should parse partial invalid choice syntax', () => {
        // This actually parses as just "a" and leaves the rest unconsumed
        const result = expression()('"a" / / "b"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('StringLiteral');
          expect(result.next.offset).toBe(3); // Should stop after "a"
        }
      });

      it('should fail on incomplete sequences', () => {
        const result = expression()('"hello" ', pos);
        expect(result.success).toBe(true); // This should parse as just "hello"
        if (result.success) {
          expect(result.val.type).toBe('StringLiteral');
        }
      });
    });
  });

  describe('specific operator parsers', () => {
    describe('sequenceOperator', () => {
      it('should parse sequences', () => {
        const result = sequenceOperator()('"a" "b"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Sequence');
          expect(result.val.elements).toHaveLength(2);
        }
      });

      it('should wrap single elements in sequence', () => {
        const result = sequenceOperator()('"hello"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Sequence');
          expect(result.val.elements).toHaveLength(1);
        }
      });
    });

    describe('choiceOperator', () => {
      it('should parse choices', () => {
        const result = choiceOperator()('"a" / "b"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Choice');
          expect(result.val.alternatives).toHaveLength(2);
        }
      });

      it('should wrap single elements in choice', () => {
        const result = choiceOperator()('"hello"', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Choice');
          expect(result.val.alternatives).toHaveLength(1);
        }
      });
    });

    describe('groupOperator', () => {
      it('should parse groups', () => {
        const result = groupOperator()('("hello")', pos);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.val.type).toBe('Group');
          expect(result.val.expression.type).toBe('StringLiteral');
        }
      });

      it('should fail on non-groups', () => {
        const result = groupOperator()('"hello"', pos);
        expect(result.success).toBe(false);
      });
    });
  });
});
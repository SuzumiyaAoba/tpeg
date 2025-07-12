/**
 * TPEG Integration Tests
 *
 * Tests for parsing complete TPEG files containing both grammar and transforms definitions.
 * Based on docs/peg-grammar.md specification.
 */

import { describe, expect, it } from "bun:test";
import { parse, map, sequence, star } from "tpeg-core";
import { grammarDefinition } from "./grammar";
import { transformDefinition } from "./transforms";
import { whitespace } from "./whitespace-utils";

/**
 * Parse a complete TPEG file containing grammar and transforms definitions
 * Format: grammar Name { ... } transforms Name@lang { ... } [transforms Name@lang { ... }]*
 */
const tpegFile = map(
  sequence(
    grammarDefinition,
    star(
      map(
        sequence(
          star(whitespace),
          transformDefinition,
        ),
        ([_, transform]) => transform,
      ),
    ),
  ),
  ([grammar, transforms]) => ({
    ...grammar,
    transforms: [...(grammar.transforms || []), ...transforms],
  }),
);

describe("TPEG Integration Tests", () => {
  describe("Simple Grammar with Transforms", () => {
    it("should parse simple grammar with TypeScript transforms", () => {
      const input = `
        grammar SimpleGrammar {
          @start: "expression"
          expression = "hello"
        }
        
        transforms SimpleTransforms@typescript {
          expression(captures: string) -> Result<string> {
            return { success: true, value: captures };
          }
        }
      `;
      
      const result = parse(tpegFile)(input);
      
      expect(result.success).toBe(true);
      
      if (result.success) {
        const grammar = result.val;
        
        // Check grammar structure
        expect(grammar.type).toBe("GrammarDefinition");
        expect(grammar.name).toBe("SimpleGrammar");
        
        // Check annotations
        expect(grammar.annotations).toHaveLength(1);
        expect(grammar.annotations[0].key).toBe("start");
        expect(grammar.annotations[0].value).toBe("expression");
        
        // Check grammar rules
        expect(grammar.rules).toHaveLength(1);
        expect(grammar.rules[0].name).toBe("expression");
        
        // Check transforms
        expect(grammar.transforms).toBeDefined();
        expect(grammar.transforms).toHaveLength(1);
        const transform = grammar.transforms![0];
        expect(transform.type).toBe("TransformDefinition");
        expect(transform.transformSet.name).toBe("SimpleTransforms");
        expect(transform.transformSet.targetLanguage).toBe("typescript");
        expect(transform.transformSet.functions).toHaveLength(1);
        expect(transform.transformSet.functions[0].name).toBe("expression");
      }
    });
  });

  describe("Complex Grammar with Transforms", () => {
    it("should parse arithmetic calculator with TypeScript transforms", () => {
      const input = `
        grammar ArithmeticCalculator {
          @version: "1.0"
          @description: "Simple arithmetic calculator"
          @start: "expression"
          @skip: "whitespace"
          
          expression = left:term rest:(op:add_op right:term)*
          term = left:factor rest:(op:mul_op right:factor)*
          factor = num:number / paren:"(" expr:expression ")"
          
          number = digits:[0-9]+
          add_op = "+" / "-"
          mul_op = "*" / "/"
          
          whitespace = [ \\t\\n\\r]+
        }
        
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
                default: return { success: false, error: 'Unknown operator: ' + operation.op };
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
      `;
      
      const result = parse(tpegFile)(input);
      expect(result.success).toBe(true);
      
      if (result.success) {
        const grammar = result.val;
        
        expect(grammar.type).toBe("GrammarDefinition");
        expect(grammar.name).toBe("ArithmeticCalculator");
        expect(grammar.annotations).toHaveLength(4);
        expect(grammar.rules).toHaveLength(7);
        expect(grammar.transforms).toBeDefined();
        expect(grammar.transforms).toHaveLength(1);
        
        const transform = grammar.transforms![0];
        expect(transform.transformSet.name).toBe("ArithmeticEvaluator");
        expect(transform.transformSet.targetLanguage).toBe("typescript");
        expect(transform.transformSet.functions).toHaveLength(3);
      }
    });

    it("should parse grammar with multiple transform sets", () => {
      const input = `
        grammar Calculator {
          @start: "expression"
          
          expression = left:number op:operator right:number
          number = digits:[0-9]+
          operator = "+" / "-" / "*" / "/"
        }
        
        transforms Evaluator@typescript {
          number(captures: { digits: string }) -> Result<number> {
            return { success: true, value: parseInt(captures.digits, 10) };
          }
          
          expression(captures: { left: number, op: string, right: number }) -> Result<number> {
            switch (captures.op) {
              case '+': return { success: true, value: captures.left + captures.right };
              case '-': return { success: true, value: captures.left - captures.right };
              case '*': return { success: true, value: captures.left * captures.right };
              case '/': 
                if (captures.right === 0) {
                  return { success: false, error: 'Division by zero' };
                }
                return { success: true, value: captures.left / captures.right };
              default: 
                return { success: false, error: 'Unknown operator' };
            }
          }
        }
        
        transforms ASTBuilder@typescript {
          number(captures: { digits: string }) -> Result<NumberNode> {
            return { 
              success: true, 
              value: { 
                type: 'Number', 
                value: parseInt(captures.digits, 10) 
              } 
            };
          }
          
          expression(captures: { left: NumberNode, op: string, right: NumberNode }) -> Result<ExpressionNode> {
            return { 
              success: true, 
              value: { 
                type: 'Expression', 
                left: captures.left, 
                operator: captures.op, 
                right: captures.right 
              } 
            };
          }
        }
      `;
      
      const result = parse(tpegFile)(input);
      expect(result.success).toBe(true);
      
      if (result.success) {
        const grammar = result.val;
        
        expect(grammar.type).toBe("GrammarDefinition");
        expect(grammar.name).toBe("Calculator");
        expect(grammar.rules).toHaveLength(3);
        expect(grammar.transforms).toBeDefined();
        expect(grammar.transforms).toHaveLength(2);
        
        const evaluatorTransform = grammar.transforms![0];
        expect(evaluatorTransform.transformSet.name).toBe("Evaluator");
        expect(evaluatorTransform.transformSet.targetLanguage).toBe("typescript");
        expect(evaluatorTransform.transformSet.functions).toHaveLength(2);
        
        const astBuilderTransform = grammar.transforms![1];
        expect(astBuilderTransform.transformSet.name).toBe("ASTBuilder");
        expect(astBuilderTransform.transformSet.targetLanguage).toBe("typescript");
        expect(astBuilderTransform.transformSet.functions).toHaveLength(2);
      }
    });

    it("should parse grammar with Python transforms", () => {
      const input = `
        grammar JSONLite {
          @start: "value"
          @skip: "whitespace"
          
          value = obj:object / arr:array / str:string / num:number / bool:boolean / nil:"null"
          
          object = "{" pairs:(pair ("," pair)*)? "}"
          array = "[" values:(value ("," value)*)? "]"
          string = "\\"" chars:[^"]*  "\\""
          number = digits:[0-9]+
          boolean = true:"true" / false:"false"
          pair = key:string ":" value:value
          
          whitespace = [ \\t\\n\\r]+
        }
        
        transforms JSONParser@python {
          object(captures: { pairs?: Array<{key: string, value: any}> }) -> Result<dict> {
            if not captures.get('pairs'):
              return {'success': True, 'value': {}}
            
            result = {}
            for pair in captures['pairs']:
              result[pair['key']] = pair['value']
            return {'success': True, 'value': result}
          }
          
          array(captures: { values?: Array<any> }) -> Result<list> {
            if not captures.get('values'):
              return {'success': True, 'value': []}
            
            return {'success': True, 'value': captures['values']}
          }
          
          string(captures: { chars: string }) -> Result<str> {
            return {'success': True, 'value': captures['chars']}
          }
          
          number(captures: { digits: string }) -> Result<int> {
            try:
              value = int(captures['digits'])
              return {'success': True, 'value': value}
            except ValueError:
              return {'success': False, 'error': 'Invalid number format'}
          }
          
          boolean(captures: { true?: string, false?: string }) -> Result<bool> {
            if captures.get('true'):
              return {'success': True, 'value': True}
            elif captures.get('false'):
              return {'success': True, 'value': False}
            else:
              return {'success': False, 'error': 'Invalid boolean value'}
          }
        }
      `;
      
      const result = parse(tpegFile)(input);
      
      expect(result.success).toBe(true);
      
      if (result.success) {
        const grammar = result.val;
        
        expect(grammar.type).toBe("GrammarDefinition");
        expect(grammar.name).toBe("JSONLite");
        expect(grammar.annotations).toHaveLength(2);
        expect(grammar.rules.length).toBeGreaterThan(5);
        expect(grammar.transforms).toBeDefined();
        expect(grammar.transforms).toHaveLength(1);
        
        const transform = grammar.transforms![0];
        expect(transform.transformSet.name).toBe("JSONParser");
        expect(transform.transformSet.targetLanguage).toBe("python");
        expect(transform.transformSet.functions).toHaveLength(5);
      }
    });
  });
}); 
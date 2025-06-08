import { describe, expect, it } from "bun:test";
import {
  type Literal,
  type Identifier,
  type Sequence,
  type Choice,
  type Optional,
  type CharClass,
  type AnyChar,
  type AndPredicate,
  type NotPredicate,
  type Definition,
  type Grammar,
  type PegAstNode,
  type ExprNode,
  literal,
  identifier,
  sequence,
  choice,
  optional,
  charClass,
  char,
  range,
  anyChar,
  andPredicate,
  notPredicate,
  definition,
  grammar,
  isLiteral,
  isIdentifier,
  isSequence,
  isChoice,
  isOptional,
  isCharClass,
  isAnyChar,
  isAndPredicate,
  isNotPredicate,
  isChar,
  isRange,
  isDefinition,
  isGrammar,
} from "./index";

describe("AST Type Safety Tests", () => {
  describe("Literal Type Tests", () => {
    it("should create literal with correct type", () => {
      const lit = literal("hello");
      expect(lit.type).toBe("literal");
      expect(lit.value).toBe("hello");
    });

    it("should preserve literal type in TypeScript", () => {
      const lit = literal("hello");
      
      // TypeScriptでは具体的なリテラル型が推論される
      expect(lit.value).toBe("hello");
      expect(lit.type).toBe("literal");
    });


  });

  describe("Identifier Type Tests", () => {
    it("should create identifier with correct type", () => {
      const id = identifier("variable");
      expect(id.type).toBe("identifier");
      expect(id.value).toBe("variable");
    });

    it("should preserve identifier literal type", () => {
      const id = identifier("myVar");
      
      expect(id.value).toBe("myVar");
      expect(id.type).toBe("identifier");
    });
  });

  describe("Composite Types Tests", () => {
    it("should create sequence with correct children types", () => {
      const lit1 = literal("hello");
      const lit2 = literal("world");
      const seq = sequence(lit1, lit2);
      
      expect(seq.type).toBe("sequence");
      expect(seq.children).toHaveLength(2);
      expect(seq.children[0]).toBe(lit1);
      expect(seq.children[1]).toBe(lit2);
    });

    it("should create choice with correct children types", () => {
      const lit1 = literal("a");
      const lit2 = literal("b");
      const ch = choice(lit1, lit2);
      
      expect(ch.type).toBe("choice");
      expect(ch.children).toHaveLength(2);
    });

    it("should create optional with single child", () => {
      const lit = literal("optional");
      const opt = optional(lit);
      
      expect(opt.type).toBe("optional");
      expect(opt.children).toHaveLength(1);
      expect(opt.children[0]).toBe(lit);
    });
  });

  describe("Character Class Tests", () => {
    it("should create character class with chars and ranges", () => {
      const charA = char("a");
      const rangeAZ = range("a", "z");
      const cc = charClass(charA, rangeAZ);
      
      expect(cc.type).toBe("charClass");
      expect(cc.children).toHaveLength(2);
      expect(cc.children[0]).toBe(charA);
      expect(cc.children[1]).toBe(rangeAZ);
    });

    it("should create char with correct type", () => {
      const c = char("x");
      expect(c.type).toBe("char");
      expect(c.value).toBe("x");
    });

    it("should create range with correct type", () => {
      const r = range("0", "9");
      expect(r.type).toBe("range");
      expect(r.value).toEqual(["0", "9"]);
    });
  });

  describe("Predicate Tests", () => {
    it("should create and predicate", () => {
      const lit = literal("test");
      const andPred = andPredicate(lit);
      
      expect(andPred.type).toBe("andPredicate");
      expect(andPred.children).toHaveLength(1);
      expect(andPred.children[0]).toBe(lit);
    });

    it("should create not predicate", () => {
      const lit = literal("test");
      const notPred = notPredicate(lit);
      
      expect(notPred.type).toBe("notPredicate");
      expect(notPred.children).toHaveLength(1);
      expect(notPred.children[0]).toBe(lit);
    });
  });

  describe("Grammar Structure Tests", () => {
    it("should create definition with identifier and expression", () => {
      const expr = literal("value");
      const def = definition("rule", expr);
      
      expect(def.type).toBe("definition");
      expect(def.children).toHaveLength(2);
      expect(def.children[0].type).toBe("identifier");
      expect(def.children[0].value).toBe("rule");
      expect(def.children[1]).toBe(expr);
    });

    it("should create grammar with definitions", () => {
      const def1 = definition("rule1", literal("a"));
      const def2 = definition("rule2", literal("b"));
      const gram = grammar(def1, def2);
      
      expect(gram.type).toBe("grammar");
      expect(gram.children).toHaveLength(2);
      expect(gram.children[0]).toBe(def1);
      expect(gram.children[1]).toBe(def2);
    });
  });

  describe("Type Guard Tests", () => {
    it("should correctly identify node types", () => {
      const lit = literal("test");
      const id = identifier("var");
      const seq = sequence(lit);
      const ch = choice(lit);
      const opt = optional(lit);
      const cc = charClass(char("a"));
      const any = anyChar();
      const andPred = andPredicate(lit);
      const notPred = notPredicate(lit);
      const c = char("x");
      const r = range("a", "z");
      const def = definition("rule", lit);
      const gram = grammar(def);
      
      expect(isLiteral(lit)).toBe(true);
      expect(isIdentifier(lit)).toBe(false);
      
      expect(isIdentifier(id)).toBe(true);
      expect(isLiteral(id)).toBe(false);
      
      expect(isSequence(seq)).toBe(true);
      expect(isChoice(ch)).toBe(true);
      expect(isOptional(opt)).toBe(true);
      expect(isCharClass(cc)).toBe(true);
      expect(isAnyChar(any)).toBe(true);
      expect(isAndPredicate(andPred)).toBe(true);
      expect(isNotPredicate(notPred)).toBe(true);
      expect(isChar(c)).toBe(true);
      expect(isRange(r)).toBe(true);
      expect(isDefinition(def)).toBe(true);
      expect(isGrammar(gram)).toBe(true);
    });

    it("should provide correct type narrowing", () => {
      const node: PegAstNode = literal("test");
      
      if (isLiteral(node)) {
        // 型が正しくnarrowingされているか確認
        expect(node.value).toBe("test");
        expect(node.type).toBe("literal");
      }
    });

    it("should correctly identify mixed node types", () => {
      const nodes: PegAstNode[] = [
        literal("lit") as PegAstNode,
        identifier("id") as PegAstNode,
        char("c") as PegAstNode,
        range("a", "z") as PegAstNode,
        anyChar() as PegAstNode,
      ];
      
      expect(isLiteral(nodes[0])).toBe(true);
      expect(isIdentifier(nodes[1])).toBe(true);
      expect(isChar(nodes[2])).toBe(true);
      expect(isRange(nodes[3])).toBe(true);
      expect(isAnyChar(nodes[4])).toBe(true);
      
      // 相互排他的であることを確認
      expect(isLiteral(nodes[1])).toBe(false);
      expect(isIdentifier(nodes[0])).toBe(false);
    });
  });

  describe("Type Safety Edge Cases", () => {
    it("should handle empty sequences and choices", () => {
      const emptySeq = sequence();
      const emptyChoice = choice();
      
      expect(emptySeq.children).toHaveLength(0);
      expect(emptyChoice.children).toHaveLength(0);
      expect(emptySeq.type).toBe("sequence");
      expect(emptyChoice.type).toBe("choice");
    });

    it("should preserve readonly arrays in function parameters", () => {
      const exprs = [literal("a"), literal("b")] as const;
      const seq = sequence(...exprs);
      
      expect(seq.children).toHaveLength(2);
      expect((seq.children[0] as Literal).value).toBe("a");
      expect((seq.children[1] as Literal).value).toBe("b");
    });

    it("should handle nested structures correctly", () => {
      const innerSeq = sequence(literal("a"), literal("b"));
      const outerChoice = choice(innerSeq, literal("c"));
      const optionalChoice = optional(outerChoice);
      
      expect(optionalChoice.type).toBe("optional");
      expect(optionalChoice.children[0].type).toBe("choice");
      
              if (isOptional(optionalChoice)) {
          const choiceNode = optionalChoice.children[0] as PegAstNode;
          if (isChoice(choiceNode)) {
          expect(choiceNode.children).toHaveLength(2);
          expect(isSequence(choiceNode.children[0] as PegAstNode)).toBe(true);
          expect(isLiteral(choiceNode.children[1] as PegAstNode)).toBe(true);
        }
      }
    });
  });



    describe("Complex AST Construction", () => {
    it("should build simple grammar structures", () => {
      // 基本的な文法構造のテスト
      const simpleExpr = literal("hello");
      const simpleRule = definition("greeting", simpleExpr);
      const simpleGrammar = grammar(simpleRule);
      
      expect(simpleGrammar.type).toBe("grammar");
      expect(simpleGrammar.children).toHaveLength(1);
      expect(simpleGrammar.children[0].type).toBe("definition");
    });

    it("should build choice-based rules", () => {
      // 選択肢を持つルール
      const optionA = literal("yes");
      const optionB = literal("no");
      const yesOrNo = choice(optionA, optionB);
      
      const boolRule = definition("boolean", yesOrNo);
      const boolGrammar = grammar(boolRule);
      
      expect(boolGrammar.type).toBe("grammar");
      expect(boolGrammar.children).toHaveLength(1);
      
      const rule = boolGrammar.children[0];
      expect(rule.type).toBe("definition");
      expect(rule.children).toHaveLength(2);
      expect(rule.children[1].type).toBe("choice");
    });
  });
}); 
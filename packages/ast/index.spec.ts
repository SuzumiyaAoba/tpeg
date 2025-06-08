import { describe, expect, it } from "bun:test";
import {
  type Literal,
  type Identifier,
  type Sequence,
  type Choice,
  type Optional,
  type MapNode,
  type CharClass,
  type AnyChar,
  type AndPredicate,
  type NotPredicate,
  type Definition,
  type Grammar,
  type PegAstNode,
  type ExprNode,
  type Char,
  type Range,
  literal,
  identifier,
  sequence,
  choice,
  optional,
  map,
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
  isMap,
  isCharClass,
  isAnyChar,
  isAndPredicate,
  isNotPredicate,
  isChar,
  isRange,
  isDefinition,
  isGrammar,
} from "./index";

// Import helper types for type-level testing
import type {
  Expect,
  Not,
  Equal,
  TypesMatch,
  TestSuite,
  IsNodeType,
  ExtractLiteralValue,
  ExtractNodeType,
} from "./test-types";

// Type-level tests have been moved to a separate file (index.type-test.ts)

  describe("AST Type Safety Tests", () => {
    describe("Type-Level Tests", () => {
      it("should perform compile-time type checking", () => {
        // Type-level tests do nothing at runtime but are type-checked at compile time
        
        // Correct type combinations should not cause errors
        const testLiteral = literal("test");
        const testIdentifier = identifier("myVar");
        const testChar = char("x");
        const testRange = range("a", "z");
        
        expect(testLiteral.type).toBe("literal");
        expect(testIdentifier.type).toBe("identifier");
        expect(testChar.type).toBe("char");
        expect(testRange.type).toBe("range");
      });

      it("should validate type compatibility at compile time", () => {
        // Test compile-time type compatibility
        const testLiteral = literal("hello");
        const testIdentifier = identifier("myVar");
        const testChar = char("x");
        const testRange = range("a", "z");
        
        // Verify that type inference works correctly
        expect(testLiteral.value).toBe("hello");
        expect(testIdentifier.value).toBe("myVar");
        expect(testChar.value).toBe("x");
        expect(testRange.value).toEqual(["a", "z"]);
        
        // Verify type guard behavior
        expect(isLiteral(testLiteral)).toBe(true);
        expect(isIdentifier(testIdentifier)).toBe(true);
        expect(isChar(testChar)).toBe(true);
        expect(isRange(testRange)).toBe(true);
        
        // Mutually exclusive type guards
        expect(isLiteral(testChar)).toBe(false);
        expect(isChar(testLiteral)).toBe(false);
      });

      it("should validate complex type relationships", () => {
        // Test complex type relationships
        const lit = literal("test");
        const seq = sequence(lit);
        const choiceNode = choice(lit); // Rename variable to avoid import collision
        const opt = optional(lit);
        
        // Test type narrowing using type guards
        const nodes: PegAstNode[] = [lit, seq, choiceNode, opt];
        
        for (const node of nodes) {
          if (isLiteral(node)) {
            // At this point, node is treated as Literal type
            expect(node.value).toBe("test");
          } else if (isSequence(node)) {
            // At this point, node is treated as Sequence type
            expect(node.children.length).toBeGreaterThanOrEqual(0);
          } else if (isChoice(node)) {
            // At this point, node is treated as Choice type
            expect(node.children.length).toBeGreaterThanOrEqual(0);
          } else if (isOptional(node)) {
            // At this point, node is treated as Optional type
            expect(node.children.length).toBe(1);
          }
        }
      });
    });

    describe("Literal Type Tests", () => {
      it("should create literal with correct type", () => {
        const lit = literal("hello");
        expect(lit.type).toBe("literal");
        expect(lit.value).toBe("hello");
      });

      it("should preserve literal type in TypeScript", () => {
        const lit = literal("hello");
        
        // In TypeScript, specific literal types are inferred
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

    it("should preserve literal types for char", () => {
      const charA = char("a");
      const charB = char("b");
      const charNewline = char("\n");
      
      expect(charA.value).toBe("a");
      expect(charB.value).toBe("b");
      expect(charNewline.value).toBe("\n");
      
      // In TypeScript, specific literal types are inferred
      expect(charA.type).toBe("char");
      expect(charB.type).toBe("char");
    });

    it("should preserve literal types for range", () => {
      const rangeAZ = range("a", "z");
      const range09 = range("0", "9");
      const rangeCustom = range("!", "~");
      
      expect(rangeAZ.value).toEqual(["a", "z"]);
      expect(range09.value).toEqual(["0", "9"]);
      expect(rangeCustom.value).toEqual(["!", "~"]);
      
      // In TypeScript, specific literal types are inferred
      expect(rangeAZ.type).toBe("range");
      expect(range09.type).toBe("range");
    });

    it("should handle special characters in char and range", () => {
      const charSpace = char(" ");
      const charTab = char("\t");
      const charQuote = char("'");
      const charBackslash = char("\\");
      
      expect(charSpace.value).toBe(" ");
      expect(charTab.value).toBe("\t");
      expect(charQuote.value).toBe("'");
      expect(charBackslash.value).toBe("\\");
      
      const rangeSpecial = range("!", "/");
      expect(rangeSpecial.value).toEqual(["!", "/"]);
    });

    it("should work with char class containing typed chars and ranges", () => {
      const charA = char("a");
      const charZ = char("z");
      const range09 = range("0", "9");
      const rangeAZ = range("A", "Z");
      
      const cc = charClass(charA, charZ, range09, rangeAZ);
      
      expect(cc.type).toBe("charClass");
      expect(cc.children).toHaveLength(4);
      
      // Test using type guards
      expect(isChar(cc.children[0])).toBe(true);
      expect(isChar(cc.children[1])).toBe(true);
      expect(isRange(cc.children[2])).toBe(true);
      expect(isRange(cc.children[3])).toBe(true);
      
      if (isChar(cc.children[0])) {
        expect(cc.children[0].value).toBe("a");
      }
      if (isRange(cc.children[2])) {
        expect(cc.children[2].value).toEqual(["0", "9"]);
      }
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
        // Verify that types are correctly narrowed
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
      
      // Verify mutual exclusivity
      expect(isLiteral(nodes[1])).toBe(false);
      expect(isIdentifier(nodes[0])).toBe(false);
    });
  });

      describe("Advanced Type-Level Testing", () => {
      it("should validate type inference with literal types", () => {
        // Verify that specific literal types are inferred
        const specificLiteral = literal("exactValue");
        const specificIdentifier = identifier("exactName");
        const specificChar = char("a");
        const specificRange = range("0", "9");
        
        // TypeScript's type inference preserves specific literal types
        expect(specificLiteral.value).toBe("exactValue");
        expect(specificIdentifier.value).toBe("exactName");
        expect(specificChar.value).toBe("a");
        expect(specificRange.value).toEqual(["0", "9"]);
        
        // Type system level verification (compile time)
        const _typeCheck1: Literal<"exactValue"> = specificLiteral;
        const _typeCheck2: Identifier<"exactName"> = specificIdentifier;
        const _typeCheck3: Char<"a"> = specificChar;
        const _typeCheck4: Range<"0", "9"> = specificRange;
        
        // Verify that type check variables are correctly assigned
        expect(_typeCheck1).toBe(specificLiteral);
        expect(_typeCheck2).toBe(specificIdentifier);
        expect(_typeCheck3).toBe(specificChar);
        expect(_typeCheck4).toBe(specificRange);
      });

      it("should handle generic type parameters correctly", () => {
        // Test generic type parameter behavior
        function createTypedLiteral<T extends string>(value: T): Literal<T> {
          return literal(value);
        }
        
        function createTypedChar<T extends string>(value: T): Char<T> {
          return char(value);
        }
        
        const typedLit = createTypedLiteral("hello");
        const typedChar = createTypedChar("x");
        
        expect(typedLit.value).toBe("hello");
        expect(typedChar.value).toBe("x");
        expect(typedLit.type).toBe("literal");
        expect(typedChar.type).toBe("char");
      });

      it("should validate union types and type narrowing", () => {
        // Test union types and type narrowing
        type TestNode = Literal<"a"> | Literal<"b"> | Char<"x"> | Char<"y">;
        
        const nodeA: TestNode = literal("a");
        const nodeB: TestNode = literal("b");
        const charX: TestNode = char("x");
        const charY: TestNode = char("y");
        
        const testNodes: TestNode[] = [nodeA, nodeB, charX, charY];
        
        for (const node of testNodes) {
          if (isLiteral(node)) {
            // After type narrowing, treated as Literal type
            expect(["a", "b"]).toContain(node.value);
            expect(node.type).toBe("literal");
          } else if (isChar(node)) {
            // After type narrowing, treated as Char type
            expect(["x", "y"]).toContain(node.value);
            expect(node.type).toBe("char");
          }
        }
      });
    });

    describe("Char and Range Literal Type Safety", () => {
      it("should infer specific literal types for char", () => {
        const charA = char("a");
        const charDigit = char("1");
        const charSymbol = char("@");
        
        // Verify that types are correctly inferred
        expect(charA.value).toBe("a");
        expect(charDigit.value).toBe("1");
        expect(charSymbol.value).toBe("@");
        
        // Verify that type guards work correctly
        expect(isChar(charA)).toBe(true);
        expect(isRange(charA)).toBe(false);
        expect(isLiteral(charA)).toBe(false);
      });

    it("should infer specific literal types for range", () => {
      const rangeAZ = range("a", "z");
      const range09 = range("0", "9");
      const rangeSymbol = range("!", "~");
      
      // Verify that types are correctly inferred
      expect(rangeAZ.value).toEqual(["a", "z"]);
      expect(range09.value).toEqual(["0", "9"]);
      expect(rangeSymbol.value).toEqual(["!", "~"]);
      
      // Verify that type guards work correctly
      expect(isRange(rangeAZ)).toBe(true);
      expect(isChar(rangeAZ)).toBe(false);
      expect(isLiteral(rangeAZ)).toBe(false);
    });

    it("should work correctly in type narrowing contexts", () => {
      const nodes = [
        char("x") as PegAstNode,
        range("a", "z") as PegAstNode,
        literal("test") as PegAstNode,
      ];
      
      // Test type narrowing
      for (const node of nodes) {
        if (isChar(node)) {
          expect(node.type).toBe("char");
          expect(typeof node.value).toBe("string");
        } else if (isRange(node)) {
          expect(node.type).toBe("range");
          expect(Array.isArray(node.value)).toBe(true);
          expect(node.value).toHaveLength(2);
        } else if (isLiteral(node)) {
          expect(node.type).toBe("literal");
          expect(typeof node.value).toBe("string");
        }
      }
    });

    it("should maintain type safety in character class construction", () => {
      const elements = [
        char("a"),
        char("b"),
        range("0", "9"),
        range("A", "Z"),
      ];
      
      const cc = charClass(...elements);
      
      expect(cc.type).toBe("charClass");
      expect(cc.children).toHaveLength(4);
      
      // Verify that each element has the correct type
      for (let i = 0; i < cc.children.length; i++) {
        const element = cc.children[i];
        if (i < 2) {
          expect(isChar(element)).toBe(true);
        } else {
          expect(isRange(element)).toBe(true);
        }
      }
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



  describe("Complex Combinator Tests", () => {
    describe("Deeply Nested Structures", () => {
      it("should handle deeply nested sequences", () => {
        const innerSeq = sequence(literal("a"), literal("b"));
        const outerSeq = sequence(innerSeq, literal("c"));
        const deepestSeq = sequence(outerSeq, literal("d"));
        
        expect(deepestSeq.type).toBe("sequence");
        expect(deepestSeq.children).toHaveLength(2);
        expect(deepestSeq.children[0].type).toBe("sequence");
        expect(deepestSeq.children[1].type).toBe("literal");
        
        // Verify nested structure preservation
        const firstChild = deepestSeq.children[0] as Sequence;
        expect(firstChild.children).toHaveLength(2);
        expect(firstChild.children[0].type).toBe("sequence");
      });

             it("should handle nested choices with mixed types", () => {
         const charClassA = charClass(char("a"));
         const charClassB = charClass(char("b"));
         const charOptions = choice(charClassA, charClassB);
         const literalOptions = choice(literal("hello"), literal("world"));
         const mixedChoice = choice(charOptions, literalOptions);
         
         expect(mixedChoice.type).toBe("choice");
         expect(mixedChoice.children).toHaveLength(2);
         expect(mixedChoice.children[0].type).toBe("choice");
         expect(mixedChoice.children[1].type).toBe("choice");
       });

      it("should handle complex optional nesting", () => {
        const baseExpr = literal("base");
        const firstOpt = optional(baseExpr);
        const secondOpt = optional(firstOpt);
        const thirdOpt = optional(secondOpt);
        
        expect(thirdOpt.type).toBe("optional");
        expect(thirdOpt.children).toHaveLength(1);
        expect(thirdOpt.children[0].type).toBe("optional");
        
        // Verify deep nesting
        const secondLevel = thirdOpt.children[0] as Optional;
        expect(secondLevel.children).toHaveLength(1);
        expect(secondLevel.children[0].type).toBe("optional");
      });
    });

    describe("Mixed Combinator Structures", () => {
      it("should handle sequence with choice and optional", () => {
        const signChoice = choice(literal("+"), literal("-"));
        const signOpt = optional(signChoice);
        const digit = charClass(range("0", "9"));
        const numberSeq = sequence(signOpt, digit);
        
        expect(numberSeq.type).toBe("sequence");
        expect(numberSeq.children).toHaveLength(2);
        expect(numberSeq.children[0].type).toBe("optional");
        expect(numberSeq.children[1].type).toBe("charClass");
        
        // Verify internal structure
        const optionalSign = numberSeq.children[0] as Optional;
        expect(optionalSign.children[0].type).toBe("choice");
      });

      it("should handle choice with complex nested elements", () => {
        const ifStmt = sequence(literal("if"), identifier("condition"), literal("then"));
        const whileStmt = sequence(literal("while"), identifier("condition"), literal("do"));
        const statements = choice(ifStmt, whileStmt);
        
        expect(statements.type).toBe("choice");
        expect(statements.children).toHaveLength(2);
        
        for (const child of statements.children) {
          expect(child.type).toBe("sequence");
          const seqChild = child as Sequence;
          expect(seqChild.children).toHaveLength(3);
        }
      });

      it("should handle predicate combinators with complex expressions", () => {
        const complexExpr = sequence(
          charClass(char("a"), range("b", "z")),
          optional(literal("suffix"))
        );
        
        const andPred = andPredicate(complexExpr);
        const notPred = notPredicate(complexExpr);
        
        expect(andPred.type).toBe("andPredicate");
        expect(notPred.type).toBe("notPredicate");
        
        expect(andPred.children).toHaveLength(1);
        expect(notPred.children).toHaveLength(1);
        
        expect(andPred.children[0].type).toBe("sequence");
        expect(notPred.children[0].type).toBe("sequence");
      });

      it("should handle nested predicate combinators", () => {
        const baseExpr = literal("test");
        const notExpr = notPredicate(baseExpr);
        const andNotExpr = andPredicate(notExpr);
        
        expect(andNotExpr.type).toBe("andPredicate");
        expect(andNotExpr.children).toHaveLength(1);
        expect(andNotExpr.children[0].type).toBe("notPredicate");
        
        const innerNotPred = andNotExpr.children[0] as NotPredicate;
        expect(innerNotPred.children).toHaveLength(1);
        expect(innerNotPred.children[0].type).toBe("literal");
      });
    });

    describe("Complex Character Classes", () => {
      it("should handle character class with multiple element types", () => {
        const alphaLower = range("a", "z");
        const alphaUpper = range("A", "Z");
        const digits = range("0", "9");
        const underscore = char("_");
        const dollar = char("$");
        
        const identifier = charClass(alphaLower, alphaUpper, digits, underscore, dollar);
        
        expect(identifier.type).toBe("charClass");
        expect(identifier.children).toHaveLength(5);
        
        // Verify element types
        expect(identifier.children[0].type).toBe("range");
        expect(identifier.children[1].type).toBe("range");
        expect(identifier.children[2].type).toBe("range");
        expect(identifier.children[3].type).toBe("char");
        expect(identifier.children[4].type).toBe("char");
      });

      it("should preserve character class element ordering", () => {
        const elements = [
          char("a"), char("b"), char("c"),
          range("x", "z"), range("0", "9")
        ];
        
        const cc = charClass(...elements);
        
        expect(cc.children).toHaveLength(5);
        
        for (let i = 0; i < elements.length; i++) {
          expect(cc.children[i]).toBe(elements[i]);
        }
      });
    });

    describe("Grammar and Definition Complex Tests", () => {
      it("should handle grammar with interdependent rules", () => {
        const exprRef = identifier("expr");
        const termRef = identifier("term");
        const factorRef = identifier("factor");
        
        const number = charClass(range("0", "9"));
        const factorDef = definition("factor", choice(number, exprRef));
        const termDef = definition("term", sequence(factorRef, optional(sequence(literal("*"), factorRef))));
        const exprDef = definition("expr", sequence(termRef, optional(sequence(literal("+"), termRef))));
        
        const arithmeticGrammar = grammar(exprDef, termDef, factorDef);
        
        expect(arithmeticGrammar.type).toBe("grammar");
        expect(arithmeticGrammar.children).toHaveLength(3);
        
        // Verify all definitions are present
        for (const def of arithmeticGrammar.children) {
          expect(def.type).toBe("definition");
          expect(def.children).toHaveLength(2);
          expect(def.children[0].type).toBe("identifier");
        }
      });

      it("should handle complex definition with nested structures", () => {
        const stringContent = sequence(
          literal('"'),
          optional(sequence(
            charClass(range("a", "z"), range("A", "Z"), range("0", "9")),
            optional(literal("\\"))
          )),
          literal('"')
        );
        
        const stringDef = definition("string", stringContent);
        
        expect(stringDef.type).toBe("definition");
        expect(stringDef.children).toHaveLength(2);
        expect(stringDef.children[0].type).toBe("identifier");
        expect(stringDef.children[1].type).toBe("sequence");
        
        // Verify nested structure
        const seqExpr = stringDef.children[1] as Sequence;
        expect(seqExpr.children).toHaveLength(3);
        expect(seqExpr.children[0].type).toBe("literal");
        expect(seqExpr.children[1].type).toBe("optional");
        expect(seqExpr.children[2].type).toBe("literal");
      });
    });

    describe("Type Safety in Complex Structures", () => {
      it("should maintain type safety across complex nesting", () => {
        const complexStructure = sequence(
          choice(literal("start"), literal("begin")),
          optional(charClass(char("a"), range("b", "z"))),
          andPredicate(notPredicate(literal("end")))
        );
        
        expect(complexStructure.type).toBe("sequence");
        expect(complexStructure.children).toHaveLength(3);
        
        // Type safety verification through type guards
        const [choiceNode, optNode, andPredNode] = complexStructure.children;
        
        expect(isChoice(choiceNode as PegAstNode)).toBe(true);
        expect(isOptional(optNode as PegAstNode)).toBe(true);
        expect(isAndPredicate(andPredNode as PegAstNode)).toBe(true);
      });

      it("should handle empty and single-element collections", () => {
        const emptySeq = sequence();
        const emptyChoice = choice();
        const singleSeq = sequence(literal("alone"));
        const singleChoice = choice(literal("only"));
        
        expect(emptySeq.children).toHaveLength(0);
        expect(emptyChoice.children).toHaveLength(0);
        expect(singleSeq.children).toHaveLength(1);
        expect(singleChoice.children).toHaveLength(1);
        
        // Type safety verification
        expect(emptySeq.type).toBe("sequence");
        expect(emptyChoice.type).toBe("choice");
        expect(singleSeq.type).toBe("sequence");
        expect(singleChoice.type).toBe("choice");
      });
    });
  });

    describe("Map Node Tests", () => {
      it("should create map node with correct type and properties", () => {
        const expr = literal("123");
        const mapper = (value: string) => Number.parseInt(value, 10);
        const mapNode = map(expr, mapper);

        expect(mapNode.type).toBe("map");
        expect(mapNode.children).toHaveLength(1);
        expect(mapNode.children[0]).toBe(expr);
        expect(mapNode.data.mapper).toBe(mapper);
      });

      it("should create map node with complex expression", () => {
        const expr = sequence(
          charClass(range("0", "9")),
          optional(literal(".")),
          charClass(range("0", "9"))
        );
        const mapper = (parts: unknown[]) => Number.parseFloat(parts.join(""));
        const mapNode = map(expr, mapper);

        expect(mapNode.type).toBe("map");
        expect(mapNode.children).toHaveLength(1);
        expect(mapNode.children[0]).toBe(expr);
        expect(mapNode.data.mapper).toBe(mapper);
      });

      it("should support nested map operations", () => {
        const innerExpr = literal("42");
        const innerMapper = (value: string) => Number.parseInt(value, 10);
        const innerMap = map(innerExpr, innerMapper);
        
        const outerMapper = (value: number) => value * 2;
        const outerMap = map(innerMap, outerMapper);

        expect(outerMap.type).toBe("map");
        expect(outerMap.children).toHaveLength(1);
        expect(outerMap.children[0]).toBe(innerMap);
        expect(outerMap.data.mapper).toBe(outerMapper);

        // Verify inner map
        expect(innerMap.type).toBe("map");
        expect(innerMap.children[0]).toBe(innerExpr);
        expect(innerMap.data.mapper).toBe(innerMapper);
      });

      it("should work with type guards", () => {
        const expr = identifier("test");
        const mapper = (value: string) => value.toUpperCase();
        const mapNode = map(expr, mapper);

        expect(isMap(mapNode)).toBe(true);
        expect(isLiteral(mapNode)).toBe(false);
        expect(isSequence(mapNode)).toBe(false);
        expect(isChoice(mapNode)).toBe(false);
      });

      it("should handle various mapper function types", () => {
        // String transformation
        const stringMap = map(literal("test"), (s: string) => s.toUpperCase());
        expect(stringMap.type).toBe("map");

        // Number transformation
        const numberMap = map(literal("123"), (s: string) => Number.parseInt(s, 10));
        expect(numberMap.type).toBe("map");

        // Object transformation
        const objectMap = map(
          sequence(literal("name"), literal(":"), literal("value")),
          ([name, _, value]: string[]) => ({ [name]: value })
        );
        expect(objectMap.type).toBe("map");

        // Array transformation
        const arrayMap = map(
          choice(literal("a"), literal("b"), literal("c")),
          (item: string) => [item]
        );
        expect(arrayMap.type).toBe("map");
      });

      it("should integrate with complex expressions", () => {
        // Create a number parser with mapping
        const digitSeq = sequence(
          charClass(range("0", "9")),
          optional(sequence(
            charClass(range("0", "9")),
            charClass(range("0", "9"))
          ))
        );
        const numberParser = map(digitSeq, (digits: string[]) => {
          return Number.parseInt(digits.join(""), 10);
        });

        expect(numberParser.type).toBe("map");
        expect(numberParser.children).toHaveLength(1);
        expect(numberParser.children[0].type).toBe("sequence");

        // Create a list parser with mapping
        const listItems = sequence(
          literal("["),
          optional(sequence(
            literal("item"),
            optional(sequence(literal(","), literal("item")))
          )),
          literal("]")
        );
        const listParser = map(listItems, (parts: string[]) => {
          return parts.filter(p => p !== "[" && p !== "]" && p !== ",");
        });

        expect(listParser.type).toBe("map");
        expect(listParser.children).toHaveLength(1);
        expect(listParser.children[0].type).toBe("sequence");
      });

      it("should work in grammar definitions", () => {
        const numberExpr = map(
          charClass(range("0", "9")),
          (digit: string) => Number.parseInt(digit, 10)
        );
        const numberDef = definition("number", numberExpr);
        const numberGrammar = grammar(numberDef);

        expect(numberGrammar.type).toBe("grammar");
        expect(numberGrammar.children).toHaveLength(1);
        
        const def = numberGrammar.children[0];
        expect(def.type).toBe("definition");
        expect(def.children).toHaveLength(2);
        expect(def.children[1].type).toBe("map");

        const mappedExpr = def.children[1] as MapNode;
        expect(mappedExpr.children).toHaveLength(1);
        expect(mappedExpr.children[0].type).toBe("charClass");
      });
    });

    describe("Unist Specification Compliance", () => {
      it("should ensure AnyChar is properly typed as Node (not Literal)", () => {
        const anyCharNode = anyChar();
        
        expect(anyCharNode.type).toBe("anyChar");
        expect(isAnyChar(anyCharNode)).toBe(true);
        
        // AnyChar should not have a value property (since it's not a Literal)
        expect('value' in anyCharNode).toBe(false);
      });

      it("should ensure all nodes can accept data and position properties", () => {
        // Test that nodes inherit from unist interfaces properly
        const lit = literal("test");
        const id = identifier("name");
        const seq = sequence(lit);
        const choiceNode = choice(lit);
        const opt = optional(lit);
        const mapNode = map(lit, (x: string) => x);
        const charNode = char("a");
        const rangeNode = range("a", "z");
        const cc = charClass(charNode);
        const anyCharNode = anyChar();
        const andPred = andPredicate(lit);
        const notPred = notPredicate(lit);
        const def = definition("rule", lit);
        const gram = grammar(def);

        // All nodes should have the type property (required by unist Node)
        const allNodes = [lit, id, seq, choiceNode, opt, mapNode, charNode, rangeNode, cc, anyCharNode, andPred, notPred, def, gram];
        
        for (const node of allNodes) {
          expect(typeof node.type).toBe("string");
          expect(node.type.length).toBeGreaterThan(0);
        }
      });

      it("should ensure Literal nodes have proper value properties", () => {
        const lit = literal("hello");
        const id = identifier("variable");
        const charNode = char("x");
        const rangeNode = range("a", "z");
        
        // All these should be Literal nodes with values
        expect(lit.value).toBe("hello");
        expect(id.value).toBe("variable");  
        expect(charNode.value).toBe("x");
        expect(rangeNode.value).toEqual(["a", "z"]);
      });

      it("should ensure Parent nodes have proper children arrays", () => {
        const lit = literal("test");
        const seq = sequence(lit);
        const choiceNode = choice(lit);
        const opt = optional(lit);
        const mapNode = map(lit, (x: string) => x);
        const cc = charClass(char("a"));
        const andPred = andPredicate(lit);
        const notPred = notPredicate(lit);
        const def = definition("rule", lit);
        const gram = grammar(def);
        
        // All these should be Parent nodes with children arrays
        const parentNodes = [seq, choiceNode, opt, mapNode, cc, andPred, notPred, def, gram];
        
        for (const node of parentNodes) {
          expect(Array.isArray(node.children)).toBe(true);
          expect(node.children.length).toBeGreaterThanOrEqual(0);
        }
      });

      it("should ensure nodes can be extended with unist-compatible data", () => {
        // Test that we can add data property (which is part of unist spec)
        const nodeWithData = { ...literal("test"), data: { customField: "value" } };
        expect(nodeWithData.data?.customField).toBe("value");
        expect(nodeWithData.type).toBe("literal");
        expect(nodeWithData.value).toBe("test");
      });
    });

    describe("Complex AST Construction", () => {
    it("should build simple grammar structures", () => {
      // Test basic grammar structures
      const simpleExpr = literal("hello");
      const simpleRule = definition("greeting", simpleExpr);
      const simpleGrammar = grammar(simpleRule);
      
      expect(simpleGrammar.type).toBe("grammar");
      expect(simpleGrammar.children).toHaveLength(1);
      expect(simpleGrammar.children[0].type).toBe("definition");
    });

    it("should build choice-based rules", () => {
      // Rules with choice options
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
/**
 * Type Integration System Tests
 */

import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type GrammarDefinition,
  createActionExpression,
  createCharRange,
  createCharacterClass,
  createChoice,
  createGrammarDefinition,
  createGroup,
  createIdentifier,
  createLabeledExpression,
  createNegativeLookahead,
  createOptional,
  createPlus,
  createPositiveLookahead,
  createQuantified,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import {
  TypeIntegrationEngine,
  type TypeIntegrationOptions,
  type TypedGrammarDefinition,
} from "./type-integration";

describe("TypeIntegrationEngine", () => {
  let engine: TypeIntegrationEngine;

  beforeEach(() => {
    engine = new TypeIntegrationEngine();
  });

  describe("Basic Type Integration", () => {
    it("should create typed grammar with complete type information", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("greeting", createStringLiteral("hello", '"')),
          createRuleDefinition(
            "number",
            createPlus(createCharacterClass([createCharRange("0", "9")])),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.name).toBe("TestGrammar");
      expect(typedGrammar.rules).toHaveLength(2);
      expect(typedGrammar.typeInference).toBeDefined();
      expect(typedGrammar.typeDefinitions).toBeDefined();
      expect(typedGrammar.imports).toBeDefined();
    });

    it("should generate correct TypeScript type definitions", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "SimpleGrammar",
        [],
        [
          createRuleDefinition("literal", createStringLiteral("test", '"')),
          createRuleDefinition(
            "optional",
            createOptional(createStringLiteral("maybe", '"')),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        'export type LiteralResult = "test";',
      );
      expect(typedGrammar.typeDefinitions).toContain(
        'export type OptionalResult = "maybe" | null;',
      );
      expect(typedGrammar.typeDefinitions).toContain(
        "export type ParserResult = LiteralResult | OptionalResult;",
      );
    });

    it("should detect rule dependencies correctly", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "DependentGrammar",
        [],
        [
          createRuleDefinition(
            "digit",
            createCharacterClass([createCharRange("0", "9")]),
          ),
          createRuleDefinition("number", createPlus(createIdentifier("digit"))),
          createRuleDefinition(
            "expression",
            createSequence([
              createIdentifier("number"),
              createStringLiteral("+", '"'),
              createIdentifier("number"),
            ]),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      const digitRule = typedGrammar.rules.find((r) => r.name === "digit");
      const numberRule = typedGrammar.rules.find((r) => r.name === "number");
      const expressionRule = typedGrammar.rules.find(
        (r) => r.name === "expression",
      );

      expect(digitRule?.dependencies).toEqual([]);
      expect(numberRule?.dependencies).toEqual(["digit"]);
      expect(expressionRule?.dependencies).toEqual(["number"]);
    });

    it("should detect dependencies in nested expressions", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "NestedDepsGrammar",
        [],
        [
          createRuleDefinition("dep", createStringLiteral("val", '"')),
          createRuleDefinition(
            "complex",
            createSequence([
              createGroup(createIdentifier("dep")),
              createQuantified(createIdentifier("dep"), 1, 2),
              createPositiveLookahead(createIdentifier("dep")),
              createNegativeLookahead(createIdentifier("dep")),
              createLabeledExpression("label", createIdentifier("dep")),
            ]),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);
      const complexRule = typedGrammar.rules.find((r) => r.name === "complex");

      expect(complexRule?.dependencies).toEqual(["dep"]);
    });

    it("detects a dependency reached through a semantic action's wrapped expression (regression)", () => {
      // `analyzeDependencies`'s traversal switch had no case for
      // `ActionExpression` -- a `switch` with no matching case (and no
      // `default`) silently does nothing rather than failing to compile,
      // so a rule wrapping its pattern in an action always reported ZERO
      // dependencies, even when the wrapped expression plainly
      // referenced another rule.
      const grammar: GrammarDefinition = createGrammarDefinition(
        "ActionDepsGrammar",
        [],
        [
          createRuleDefinition("dep", createStringLiteral("val", '"')),
          createRuleDefinition(
            "withAction",
            createActionExpression(createIdentifier("dep"), "return $$;"),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);
      const rule = typedGrammar.rules.find((r) => r.name === "withAction");

      expect(rule?.dependencies).toEqual(["dep"]);
    });

    it("should detect circular dependencies", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "CircularGrammar",
        [],
        [
          createRuleDefinition(
            "a",
            createSequence([
              createIdentifier("b"),
              createStringLiteral("end", '"'),
            ]),
          ),
          createRuleDefinition(
            "b",
            createChoice([
              createIdentifier("a"),
              createStringLiteral("base", '"'),
            ]),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      const ruleA = typedGrammar.rules.find((r) => r.name === "a");
      const ruleB = typedGrammar.rules.find((r) => r.name === "b");

      expect(ruleA?.hasCircularDependency).toBe(true);
      expect(ruleB?.hasCircularDependency).toBe(true);
      expect(
        typedGrammar.typeInference.circularDependencies.length,
      ).toBeGreaterThan(0);
    });
  });

  describe("Type Integration Options", () => {
    it("should respect type namespace option", () => {
      const options: Partial<TypeIntegrationOptions> = {
        typeNamespace: "MyGrammar",
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("value", '"'))],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        "export namespace MyGrammar {",
      );
      expect(typedGrammar.typeDefinitions).toContain("}");
    });

    it("should generate type guards when enabled", () => {
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("test", createStringLiteral("value", '"'))],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        "export function isTestResult(value: unknown): value is TestResult",
      );
      expect(typedGrammar.typeDefinitions).toContain(
        'return typeof value === "string" && value === "value";',
      );
    });

    it("should generate a guard that requires undefined for lookahead (void) results", () => {
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "test",
            createPositiveLookahead(createStringLiteral("value", '"')),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      // Lookaheads never produce a value, so the guard must check for
      // undefined, not reject it -- the generic fallback used to emit
      // the opposite condition here.
      expect(typedGrammar.typeDefinitions).toContain(
        "return value === undefined;",
      );
      expect(typedGrammar.typeDefinitions).not.toContain(
        "return value !== undefined;",
      );
    });

    it("should generate an array-checking guard for a Plus/Star result, not a string-typeof check (regression)", () => {
      // `[a-z]+` infers `{ baseType: "string", isArray: true }` (the
      // element type carried through, with `isArray` set) -- the guard
      // builder used to check `baseType` before `isArray`, so an array
      // whose ELEMENT type happened to be "string" generated
      // `typeof value === "string"`, a guard that returns `false` for
      // every value of its own declared array type.
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "word",
            createPlus(createCharacterClass([createCharRange("a", "z")])),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain("string[]");
      expect(typedGrammar.typeDefinitions).toContain(
        'return Array.isArray(value) && value.every((el: unknown) => typeof el === "string");',
      );
      expect(typedGrammar.typeDefinitions).not.toContain(
        'return typeof value === "string";',
      );
    });

    it("should generate an object-shaped guard for labeled expression results", () => {
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "test",
            createLabeledExpression("label", createStringLiteral("value", '"')),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        'return typeof value === "object" && value !== null;',
      );
    });

    it("should generate a per-alternative guard for union (Choice) results", () => {
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "test",
            createChoice([
              createStringLiteral("yes", '"'),
              createStringLiteral("no", '"'),
            ]),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      // A union guard must check each alternative individually -- the old
      // generic fallback ("value !== undefined") accepted any defined
      // value, including strings that match neither alternative.
      expect(typedGrammar.typeDefinitions).toContain(
        'return (typeof value === "string" && value === "yes") || (typeof value === "string" && value === "no");',
      );
      expect(typedGrammar.typeDefinitions).not.toContain(
        "return value !== undefined;",
      );
    });

    it("emits `export type X = never;` for a zero-alternative Choice rule, not `export type X = ;` (regression: hand-built `createChoice([])` produced a SyntaxError in the generated definitions)", () => {
      const engine = new TypeIntegrationEngine();

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [createRuleDefinition("start", createChoice([]))],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        "export type StartResult = never;",
      );
      expect(typedGrammar.typeDefinitions).not.toContain("= ;");
    });

    it("generates a `false` guard for a never result -- and for a union member -- rather than accepting every defined value (regression)", () => {
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      // `Choice(["a", emptyChoice])` infers `"a" | never`; the never
      // member's guard must be `false`, not `value !== undefined` (which
      // would make the whole union guard accept anything defined).
      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("start", createChoice([])),
          createRuleDefinition(
            "mixed",
            createChoice([createStringLiteral("a", '"'), createChoice([])]),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        "export function isStartResult(value: unknown): value is StartResult {\n    return false;",
      );
      expect(typedGrammar.typeDefinitions).toContain(
        'return (typeof value === "string" && value === "a") || (false);',
      );
    });

    it("generates a length- and per-member-checking guard for a tuple (Sequence) result", () => {
      // `("a" [0-9]+)` infers `[string, string[]]`-ish tuple -- the guard
      // must check the arity AND each slot, not merely `Array.isArray`,
      // which used to accept `[1, 2, 3]` for any tuple type.
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "pair",
            createSequence([
              createStringLiteral("a", '"'),
              createStringLiteral("b", '"'),
            ]),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        'return Array.isArray(value) && value.length === 2 && (typeof value[0] === "string" && value[0] === "a") && (typeof value[1] === "string" && value[1] === "b");',
      );
    });

    it("generates a member-or-null guard for an Optional result (`T | null`)", () => {
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "opt",
            createOptional(createStringLiteral("x", '"')),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      // `T | null` accepts the member value OR `null` -- `["x"]` and
      // `undefined` must both fail.
      expect(typedGrammar.typeDefinitions).toContain(
        'return (typeof value === "string" && value === "x") || (value === null);',
      );
    });

    it("generates a recursive element guard for an array of arrays", () => {
      // `"a" "b" *` -- a Star of a Sequence -- infers `[string, string][]`:
      // every element must itself be a 2-tuple of those members.
      const options: Partial<TypeIntegrationOptions> = {
        generateTypeGuards: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition(
            "rows",
            createStar(
              createSequence([
                createStringLiteral("a", '"'),
                createStringLiteral("b", '"'),
              ]),
            ),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        'value.every((el: unknown) => Array.isArray(el) && el.length === 2 && (typeof el[0] === "string" && el[0] === "a") && (typeof el[1] === "string" && el[1] === "b"))',
      );
    });

    it("should include documentation when enabled", () => {
      const options: Partial<TypeIntegrationOptions> = {
        includeDocumentation: true,
      };
      const engine = new TypeIntegrationEngine(options);

      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("documented", createStringLiteral("value", '"')),
          createRuleDefinition("dependent", createIdentifier("documented")),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain("/**");
      expect(typedGrammar.typeDefinitions).toContain("String literal");
      expect(typedGrammar.typeDefinitions).toContain(
        "Dependencies: documented",
      );
    });

    it("rejects rules whose pascalCased names collide instead of emitting duplicate type aliases (regression)", () => {
      const engine = new TypeIntegrationEngine({
        generateTypeGuards: true,
      });

      // `foo`, `Foo`, and `foo_bar` all pascalCase to `Foo`/`FooBar`
      // variants -- `foo` + `Foo` alone already collide on `FooResult`.
      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("foo", createStringLiteral("a", '"')),
          createRuleDefinition("Foo", createStringLiteral("b", '"')),
          createRuleDefinition("foo_bar", createStringLiteral("c", '"')),
        ],
      );

      expect(() => engine.createTypedGrammar(grammar)).toThrow(
        /PascalCase collision/,
      );
    });

    it("accepts rules with distinct generated names (control case)", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "TestGrammar",
        [],
        [
          createRuleDefinition("foo", createStringLiteral("a", '"')),
          createRuleDefinition("bar_baz", createStringLiteral("b", '"')),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);
      expect(typedGrammar.typeDefinitions).toContain("FooResult");
      expect(typedGrammar.typeDefinitions).toContain("BarBazResult");
    });
  });

  describe("Utility Methods", () => {
    let typedGrammar: TypedGrammarDefinition;

    beforeEach(() => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "UtilGrammar",
        [],
        [
          createRuleDefinition("base", createStringLiteral("base", '"')),
          createRuleDefinition("derived", createIdentifier("base")),
          createRuleDefinition("circular1", createIdentifier("circular2")),
          createRuleDefinition("circular2", createIdentifier("circular1")),
        ],
      );

      typedGrammar = engine.createTypedGrammar(grammar);
    });

    it("should get type information for specific rules", () => {
      const baseType = engine.getTypeInfo(typedGrammar, "base");
      const derivedType = engine.getTypeInfo(typedGrammar, "derived");
      const unknownType = engine.getTypeInfo(typedGrammar, "unknown");

      expect(baseType?.typeString).toBe('"base"');
      expect(derivedType?.typeString).toBe('"base"');
      expect(unknownType).toBeUndefined();
    });

    it("should detect circular dependencies for specific rules", () => {
      expect(engine.hasCircularDependency(typedGrammar, "base")).toBe(false);
      expect(engine.hasCircularDependency(typedGrammar, "derived")).toBe(false);
      expect(engine.hasCircularDependency(typedGrammar, "circular1")).toBe(
        true,
      );
      expect(engine.hasCircularDependency(typedGrammar, "circular2")).toBe(
        true,
      );
    });

    it("should get dependencies for specific rules", () => {
      const baseDeps = engine.getDependencies(typedGrammar, "base");
      const derivedDeps = engine.getDependencies(typedGrammar, "derived");

      expect(baseDeps).toEqual([]);
      expect(derivedDeps).toEqual(["base"]);
    });
  });

  describe("Parser Interface Generation", () => {
    it("should generate complete parser interface", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "ParserGrammar",
        [],
        [
          createRuleDefinition(
            "identifier",
            createCharacterClass([createCharRange("a", "z")]),
          ),
          createRuleDefinition(
            "number",
            createPlus(createCharacterClass([createCharRange("0", "9")])),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);
      const parserInterface = engine.generateParserInterface(typedGrammar);

      expect(parserInterface).toContain(
        "export interface ParserGrammarParser {",
      );
      expect(parserInterface).toContain(
        "identifier(input: string): ParseResult<IdentifierResult>;",
      );
      expect(parserInterface).toContain(
        "number(input: string): ParseResult<NumberResult>;",
      );
      expect(parserInterface).toContain("}");
    });

    it("imports ParseResult and qualifies result types emitted inside typeNamespace", () => {
      const namespaced = new TypeIntegrationEngine({
        typeNamespace: "My.Types",
      });
      const grammar: GrammarDefinition = createGrammarDefinition(
        "NsGrammar",
        [],
        [createRuleDefinition("word", createStringLiteral("w", '"'))],
      );
      const typedGrammar = namespaced.createTypedGrammar(grammar);
      const parserInterface = namespaced.generateParserInterface(typedGrammar);

      expect(typedGrammar.typeDefinitions).toContain(
        "export namespace My.Types {",
      );
      expect(parserInterface).toContain(
        'import type { ParseResult } from "@suzumiyaaoba/tpeg-core";',
      );
      expect(parserInterface).toContain(
        "word(input: string): ParseResult<My.Types.WordResult>;",
      );
    });

    it("should include warnings for circular dependencies in interface", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "CircularGrammar",
        [],
        [
          createRuleDefinition("a", createIdentifier("b")),
          createRuleDefinition("b", createIdentifier("a")),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);
      const parserInterface = engine.generateParserInterface(typedGrammar);

      expect(parserInterface).toContain(
        "@warning This rule has circular dependencies",
      );
    });
  });

  describe("Complex Type Scenarios", () => {
    it("should handle nested complex expressions", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "ComplexGrammar",
        [],
        [
          createRuleDefinition(
            "element",
            createChoice([
              createStringLiteral("a", '"'),
              createStringLiteral("b", '"'),
            ]),
          ),
          createRuleDefinition("list", createStar(createIdentifier("element"))),
          createRuleDefinition(
            "optionalList",
            createOptional(createIdentifier("list")),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      const elementType = engine.getTypeInfo(typedGrammar, "element");
      const listType = engine.getTypeInfo(typedGrammar, "list");
      const optionalListType = engine.getTypeInfo(typedGrammar, "optionalList");

      expect(elementType?.typeString).toBe('"a" | "b"');
      expect(listType?.typeString).toBe('("a" | "b")[]');
      expect(optionalListType?.typeString).toBe('("a" | "b")[] | null');
    });

    it("should convert rule names to PascalCase for types", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "NamingGrammar",
        [],
        [
          createRuleDefinition("snake_case", createStringLiteral("test", '"')),
          createRuleDefinition("kebab-case", createStringLiteral("test", '"')),
          createRuleDefinition("camelCase", createStringLiteral("test", '"')),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        "export type SnakeCaseResult",
      );
      expect(typedGrammar.typeDefinitions).toContain(
        "export type KebabCaseResult",
      );
      expect(typedGrammar.typeDefinitions).toContain(
        "export type CamelCaseResult",
      );
    });
  });

  describe("Malformed hand-built name validation", () => {
    it("should quote a non-identifier capture label instead of emitting a SyntaxError object type", () => {
      // A label like "my-label" is only reachable from a hand-built AST
      // (the grammar parser's identifier rule can't produce one); emitting
      // it bare would produce `{ my-label: ... }`, which fails to parse
      // once this typeString is written into an `export type ... = ...;`
      // alias. Quoting preserves the actual runtime key the generated
      // parser assigns via mergeCaptures.
      const grammar: GrammarDefinition = createGrammarDefinition(
        "LabelGrammar",
        [],
        [
          createRuleDefinition(
            "item",
            createSequence([
              createLabeledExpression(
                "my-label",
                createStringLiteral("x", '"'),
              ),
            ]),
          ),
        ],
      );

      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        'export type ItemResult = { "my-label": "x" };',
      );
    });

    it("should reject a rule name whose PascalCase form is not a valid identifier", () => {
      // "123abc" -> pascalCase "123abc" -> `export type 123abcResult`
      // would be a SyntaxError; reject at generation time instead.
      const grammar: GrammarDefinition = createGrammarDefinition(
        "DigitGrammar",
        [],
        [createRuleDefinition("123abc", createStringLiteral("x", '"'))],
      );

      expect(() => engine.createTypedGrammar(grammar)).toThrow(
        /not a valid TypeScript identifier/,
      );
    });

    it("should reject a rule name that PascalCases to the empty string", () => {
      // "---" splits entirely into separators -> generated name "" ->
      // `export type Result` silently detaches the type from the rule.
      const grammar: GrammarDefinition = createGrammarDefinition(
        "DashGrammar",
        [],
        [createRuleDefinition("---", createStringLiteral("x", '"'))],
      );

      expect(() => engine.createTypedGrammar(grammar)).toThrow(
        /not a valid TypeScript identifier/,
      );
    });

    it("should reject an invalid typeNamespace", () => {
      const badEngine = new TypeIntegrationEngine({
        typeNamespace: "not a namespace",
      });
      const grammar: GrammarDefinition = createGrammarDefinition(
        "NsGrammar",
        [],
        [createRuleDefinition("a", createStringLiteral("x", '"'))],
      );

      expect(() => badEngine.createTypedGrammar(grammar)).toThrow(
        /not a valid TypeScript namespace name/,
      );
    });

    it("should accept a dotted typeNamespace", () => {
      const nsEngine = new TypeIntegrationEngine({
        typeNamespace: "Outer.Inner",
      });
      const grammar: GrammarDefinition = createGrammarDefinition(
        "NsGrammar",
        [],
        [createRuleDefinition("a", createStringLiteral("x", '"'))],
      );

      const typedGrammar = nsEngine.createTypedGrammar(grammar);
      expect(typedGrammar.typeDefinitions).toContain(
        "export namespace Outer.Inner {",
      );
    });

    it("should reject a non-identifier grammar name in generateParserInterface", () => {
      const grammar: GrammarDefinition = createGrammarDefinition(
        "My Grammar",
        [],
        [createRuleDefinition("a", createStringLiteral("x", '"'))],
      );
      const typedGrammar = engine.createTypedGrammar(grammar);

      expect(() => engine.generateParserInterface(typedGrammar)).toThrow(
        /not a valid TypeScript identifier/,
      );
    });

    it("should emit a non-identifier rule name as a quoted interface method", () => {
      // `{ "my-rule"(input: string): ... }` is legal TypeScript; quoting
      // keeps the actual runtime method name instead of emitting
      // `my-rule(input...)` -- a SyntaxError.
      const grammar: GrammarDefinition = createGrammarDefinition(
        "QuotedGrammar",
        [],
        [createRuleDefinition("my-rule", createStringLiteral("x", '"'))],
      );
      const typedGrammar = engine.createTypedGrammar(grammar);
      const parserInterface = engine.generateParserInterface(typedGrammar);

      expect(parserInterface).toContain(
        '"my-rule"(input: string): ParseResult<MyRuleResult>;',
      );
    });

    it("should reject a rule name whose type reference is invalid in generateParserInterface", () => {
      // The method name can be quoted, but `ParseResult<123abcResult>`
      // cannot -- reject rather than emit a broken type reference.
      const grammar: GrammarDefinition = createGrammarDefinition(
        "IfaceGrammar",
        [],
        [createRuleDefinition("a", createStringLiteral("x", '"'))],
      );
      const typedGrammar = engine.createTypedGrammar(grammar);
      typedGrammar.rules.push({
        ...createRuleDefinition("123abc", createStringLiteral("y", '"')),
        inferredType: {
          typeString: '"y"',
          nullable: false,
          isArray: false,
          baseType: "string",
          imports: [],
        },
        hasCircularDependency: false,
        dependencies: [],
      });

      expect(() => engine.generateParserInterface(typedGrammar)).toThrow(
        /not a valid TypeScript identifier/,
      );
    });

    it("should escape `*/` inside a dependency name in the Dependencies doc line (regression)", () => {
      // `analyzeDependencies` collects `Identifier` node names verbatim --
      // including ones that reference no declared rule (only reachable
      // from a hand-built AST). Emitting one raw into the ` * ` gutter
      // used to let an embedded `*/` terminate the block comment early,
      // turning the remainder into live code in the generated file -- the
      // same defect class `docCommentLines` already escapes for the
      // documentation text itself (#86).
      const grammar: GrammarDefinition = createGrammarDefinition(
        "DepGrammar",
        [],
        [createRuleDefinition("a", createIdentifier("x*/y"))],
      );

      const typedGrammar = new TypeIntegrationEngine({
        includeDocumentation: true,
      }).createTypedGrammar(grammar);

      expect(typedGrammar.typeDefinitions).toContain(
        "   * Dependencies: x*\\/y",
      );
      expect(typedGrammar.typeDefinitions).not.toContain("x*/y");
    });

    it("should reject duplicate rule names instead of emitting duplicate type aliases (regression)", () => {
      // `createTypedGrammar` does not run `validateGrammar` itself: a
      // hand-built grammar with two rules named `dup` used to emit
      // `export type DupResult` (and `export function isDupResult` with
      // type guards on) twice -- a guaranteed SyntaxError with no
      // diagnostic.
      const grammar: GrammarDefinition = createGrammarDefinition(
        "DupGrammar",
        [],
        [
          createRuleDefinition("dup", createStringLiteral("a", '"')),
          createRuleDefinition("dup", createStringLiteral("b", '"')),
        ],
      );

      expect(() => engine.createTypedGrammar(grammar)).toThrow(
        /Duplicate rule name\(s\) "dup"/,
      );
    });
  });
});

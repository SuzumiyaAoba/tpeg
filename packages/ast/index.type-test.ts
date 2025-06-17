import type {
  AndPredicate,
  Char,
  CharClass,
  Choice,
  Definition,
  ExprNode,
  Grammar,
  Group,
  Identifier,
  Literal,
  NotPredicate,
  OneOrMore,
  Optional,
  Range,
  Sequence,
  ZeroOrMore,
} from "./index";

import type {
  andPredicate,
  char,
  charClass,
  choice,
  definition,
  grammar,
  group,
  identifier,
  literal,
  notPredicate,
  oneOrMore,
  optional,
  range,
  sequence,
  zeroOrMore,
} from "./index";

import type {
  Equal,
  Expect,
  ExtractLiteralValue,
  ExtractNodeType,
  IsNodeType,
  Not,
  TestSuite,
} from "./test-types";

// Type-level test suite
// Uses TestSuite type to perform compile-time type checking
// @ts-ignore
type TypeLevelTests = TestSuite<
  [
    // Basic literal type tests
    Expect<Equal<ReturnType<typeof literal<"hello">>, Literal<"hello">>>,
    Expect<Equal<ReturnType<typeof literal<"world">>, Literal<"world">>>,
    Expect<Not<Equal<ReturnType<typeof literal<"hello">>, Literal<"world">>>>,
    // Identifier type tests
    Expect<Equal<ReturnType<typeof identifier<"myVar">>, Identifier<"myVar">>>,
    Expect<
      Not<Equal<ReturnType<typeof identifier<"myVar">>, Identifier<"otherVar">>>
    >,
    // Character type tests
    Expect<Equal<ReturnType<typeof char<"a">>, Char<"a">>>,
    Expect<Equal<ReturnType<typeof char<"1">>, Char<"1">>>,
    Expect<Not<Equal<ReturnType<typeof char<"a">>, Char<"b">>>>,
    // Range type tests
    Expect<Equal<ReturnType<typeof range<"a", "z">>, Range<"a", "z">>>,
    Expect<Equal<ReturnType<typeof range<"0", "9">>, Range<"0", "9">>>,
    Expect<Not<Equal<ReturnType<typeof range<"a", "z">>, Range<"0", "9">>>>,
    // Composite type tests - updated for generic types
    Expect<
      Equal<
        ReturnType<typeof sequence<[Literal<"a">, Literal<"b">]>>,
        Sequence<[Literal<"a">, Literal<"b">]>
      >
    >,
    Expect<
      Equal<
        ReturnType<typeof choice<[Literal<"a">, Literal<"b">]>>,
        Choice<[Literal<"a">, Literal<"b">]>
      >
    >,
    Expect<
      Equal<
        ReturnType<typeof optional<Literal<"test">>>,
        Optional<Literal<"test">>
      >
    >,
    // Type assignability tests - updated for generic types
    Expect<Equal<Literal<string> extends ExprNode ? true : false, true>>,
    Expect<Equal<Identifier<string> extends ExprNode ? true : false, true>>,
    Expect<
      Equal<Sequence<readonly ExprNode[]> extends ExprNode ? true : false, true>
    >,
    Expect<
      Equal<Choice<readonly ExprNode[]> extends ExprNode ? true : false, true>
    >,
    Expect<Equal<ZeroOrMore<ExprNode> extends ExprNode ? true : false, true>>,
    Expect<Equal<OneOrMore<ExprNode> extends ExprNode ? true : false, true>>,
    Expect<Equal<Group<ExprNode> extends ExprNode ? true : false, true>>,
    Expect<Equal<Char<string> extends ExprNode ? true : false, false>>, // Char is not an ExprNode
    Expect<Equal<Range<string, string> extends ExprNode ? true : false, false>>, // Range is not an ExprNode
    // Type helper tests
    Expect<IsNodeType<Literal<"test">, "literal">>,
    Expect<IsNodeType<Char<"a">, "char">>,
    Expect<Not<IsNodeType<Literal<"test">, "char">>>,
    // Value and node type extraction tests
    Expect<Equal<ExtractLiteralValue<Literal<"hello">>, "hello">>,
    Expect<Equal<ExtractLiteralValue<Char<"x">>, "x">>,
    Expect<Equal<ExtractNodeType<Literal<"test">>, "literal">>,
    Expect<Equal<ExtractNodeType<Char<"a">>, "char">>,
    // Complex combinator type tests

    // Nested sequences - preserve exact tuple types
    Expect<
      Equal<
        ReturnType<
          typeof sequence<
            [Sequence<[Literal<"a">, Literal<"b">]>, Literal<"c">]
          >
        >,
        Sequence<[Sequence<[Literal<"a">, Literal<"b">]>, Literal<"c">]>
      >
    >,
    // Nested choices - preserve exact tuple types
    Expect<
      Equal<
        ReturnType<
          typeof choice<[Choice<[Literal<"x">, Literal<"y">]>, Literal<"z">]>
        >,
        Choice<[Choice<[Literal<"x">, Literal<"y">]>, Literal<"z">]>
      >
    >,
    // Mixed nesting - sequence containing choice and optional
    Expect<
      Equal<
        ReturnType<
          typeof sequence<
            [
              Choice<[Literal<"if">, Literal<"while">]>,
              Optional<Identifier<"condition">>,
              Literal<"then">,
            ]
          >
        >,
        Sequence<
          [
            Choice<[Literal<"if">, Literal<"while">]>,
            Optional<Identifier<"condition">>,
            Literal<"then">,
          ]
        >
      >
    >,
    // Complex character classes - preserve multiple element types
    Expect<
      Equal<
        ReturnType<
          typeof charClass<
            [Char<"a">, Range<"b", "z">, Char<"0">, Range<"1", "9">]
          >
        >,
        CharClass<[Char<"a">, Range<"b", "z">, Char<"0">, Range<"1", "9">]>
      >
    >,
    // Predicate combinator tests
    Expect<
      Equal<
        ReturnType<typeof andPredicate<Literal<"lookahead">>>,
        AndPredicate<Literal<"lookahead">>
      >
    >,
    Expect<
      Equal<
        ReturnType<typeof notPredicate<CharClass<[Range<"a", "z">]>>>,
        NotPredicate<CharClass<[Range<"a", "z">]>>
      >
    >,
    // Repetition combinator tests
    Expect<
      Equal<
        ReturnType<typeof zeroOrMore<Literal<"repeat">>>,
        ZeroOrMore<Literal<"repeat">>
      >
    >,
    Expect<
      Equal<
        ReturnType<typeof oneOrMore<CharClass<[Range<"0", "9">]>>>,
        OneOrMore<CharClass<[Range<"0", "9">]>>
      >
    >,
    Expect<
      Equal<
        ReturnType<
          typeof group<Sequence<[Literal<"grouped">, Literal<"expression">]>>
        >,
        Group<Sequence<[Literal<"grouped">, Literal<"expression">]>>
      >
    >,
    // Definition and Grammar complex types
    Expect<
      Equal<
        ReturnType<
          typeof definition<
            "number",
            Sequence<
              [
                Optional<Choice<[Literal<"+">, Literal<"-">]>>,
                CharClass<[Range<"0", "9">]>,
              ]
            >
          >
        >,
        Definition<
          Identifier<"number">,
          Sequence<
            [
              Optional<Choice<[Literal<"+">, Literal<"-">]>>,
              CharClass<[Range<"0", "9">]>,
            ]
          >
        >
      >
    >,
    // Grammar with multiple complex definitions
    Expect<
      Equal<
        ReturnType<
          typeof grammar<
            [
              Definition<
                Identifier<"expr">,
                Choice<[Identifier<"number">, Identifier<"string">]>
              >,
              Definition<
                Identifier<"number">,
                Sequence<[Optional<Literal<"-">>, CharClass<[Range<"0", "9">]>]>
              >,
            ]
          >
        >,
        Grammar<
          [
            Definition<
              Identifier<"expr">,
              Choice<[Identifier<"number">, Identifier<"string">]>
            >,
            Definition<
              Identifier<"number">,
              Sequence<[Optional<Literal<"-">>, CharClass<[Range<"0", "9">]>]>
            >,
          ]
        >
      >
    >,
    // Deeply nested optional structures
    Expect<
      Equal<
        ReturnType<
          typeof optional<
            Optional<Sequence<[Literal<"deeply">, Literal<"nested">]>>
          >
        >,
        Optional<Optional<Sequence<[Literal<"deeply">, Literal<"nested">]>>>
      >
    >,
    // Complex predicate nesting
    Expect<
      Equal<
        ReturnType<
          typeof andPredicate<
            NotPredicate<Choice<[Literal<"not">, Literal<"this">]>>
          >
        >,
        AndPredicate<NotPredicate<Choice<[Literal<"not">, Literal<"this">]>>>
      >
    >,
    // Complex repetition nesting
    Expect<
      Equal<
        ReturnType<typeof zeroOrMore<OneOrMore<Group<Literal<"nested">>>>>,
        ZeroOrMore<OneOrMore<Group<Literal<"nested">>>>
      >
    >,
    Expect<
      Equal<
        ReturnType<
          typeof group<ZeroOrMore<Choice<[Literal<"a">, Literal<"b">]>>>
        >,
        Group<ZeroOrMore<Choice<[Literal<"a">, Literal<"b">]>>>
      >
    >,
    Expect<
      Equal<
        ReturnType<
          typeof oneOrMore<
            Group<Sequence<[Literal<"repeat">, Literal<"this">]>>
          >
        >,
        OneOrMore<Group<Sequence<[Literal<"repeat">, Literal<"this">]>>>
      >
    >,
    // Type compatibility with deeply nested structures
    Expect<
      Equal<
        Sequence<
          [Choice<[Literal<"a">, Literal<"b">]>, Optional<Literal<"c">>]
        > extends ExprNode
          ? true
          : false,
        true
      >
    >,
    Expect<
      Equal<
        AndPredicate<
          NotPredicate<CharClass<[Char<"x">, Range<"a", "z">]>>
        > extends ExprNode
          ? true
          : false,
        true
      >
    >,
    Expect<
      Equal<
        ZeroOrMore<
          OneOrMore<Group<Choice<[Literal<"complex">, Literal<"nesting">]>>>
        > extends ExprNode
          ? true
          : false,
        true
      >
    >,
    Expect<
      Equal<
        Group<ZeroOrMore<AndPredicate<Literal<"predicate">>>> extends ExprNode
          ? true
          : false,
        true
      >
    >,
    // Empty sequence and choice types
    Expect<Equal<ReturnType<typeof sequence<[]>>, Sequence<[]>>>,
    Expect<Equal<ReturnType<typeof choice<[]>>, Choice<[]>>>,
    // Single element sequence and choice preserve exact types
    Expect<
      Equal<
        ReturnType<typeof sequence<[Literal<"single">]>>,
        Sequence<[Literal<"single">]>
      >
    >,
    Expect<
      Equal<
        ReturnType<typeof choice<[Identifier<"only">]>>,
        Choice<[Identifier<"only">]>
      >
    >,
    // Advanced type pattern tests

    // Conditional statement syntax elements
    Expect<
      Equal<
        ReturnType<
          typeof sequence<
            [
              Choice<[Literal<"if">, Literal<"unless">]>,
              Optional<Literal<"(">>,
              Identifier<"condition">,
              Optional<Literal<")">>,
              Literal<"then">,
            ]
          >
        >,
        Sequence<
          [
            Choice<[Literal<"if">, Literal<"unless">]>,
            Optional<Literal<"(">>,
            Identifier<"condition">,
            Optional<Literal<")">>,
            Literal<"then">,
          ]
        >
      >
    >,
    // Function definition syntax elements
    Expect<
      Equal<
        ReturnType<
          typeof sequence<
            [
              Literal<"function">,
              Identifier<"name">,
              Literal<"(">,
              Optional<
                Sequence<
                  [
                    Identifier<"param">,
                    Optional<Sequence<[Literal<",">, Identifier<"param">]>>,
                  ]
                >
              >,
              Literal<")">,
              Literal<"{">,
            ]
          >
        >,
        Sequence<
          [
            Literal<"function">,
            Identifier<"name">,
            Literal<"(">,
            Optional<
              Sequence<
                [
                  Identifier<"param">,
                  Optional<Sequence<[Literal<",">, Identifier<"param">]>>,
                ]
              >
            >,
            Literal<")">,
            Literal<"{">,
          ]
        >
      >
    >,
    // Complex numeric literal definition (Char cannot be used directly in Choice, so wrap with CharClass)
    Expect<
      Equal<
        ReturnType<
          typeof sequence<
            [
              Optional<Choice<[Literal<"+">, Literal<"-">]>>,
              Choice<
                [
                  Sequence<
                    [
                      CharClass<[Range<"1", "9">]>,
                      Optional<CharClass<[Range<"0", "9">]>>,
                    ]
                  >,
                  CharClass<[Char<"0">]>,
                ]
              >,
              Optional<Sequence<[Literal<".">, CharClass<[Range<"0", "9">]>]>>,
              Optional<
                Sequence<
                  [
                    Choice<[Literal<"e">, Literal<"E">]>,
                    Optional<Choice<[Literal<"+">, Literal<"-">]>>,
                    CharClass<[Range<"0", "9">]>,
                  ]
                >
              >,
            ]
          >
        >,
        Sequence<
          [
            Optional<Choice<[Literal<"+">, Literal<"-">]>>,
            Choice<
              [
                Sequence<
                  [
                    CharClass<[Range<"1", "9">]>,
                    Optional<CharClass<[Range<"0", "9">]>>,
                  ]
                >,
                CharClass<[Char<"0">]>,
              ]
            >,
            Optional<Sequence<[Literal<".">, CharClass<[Range<"0", "9">]>]>>,
            Optional<
              Sequence<
                [
                  Choice<[Literal<"e">, Literal<"E">]>,
                  Optional<Choice<[Literal<"+">, Literal<"-">]>>,
                  CharClass<[Range<"0", "9">]>,
                ]
              >
            >,
          ]
        >
      >
    >,
  ]
>;

// Execute type-level tests (only evaluated at compile time)
// Export as type is sufficient
export type { TypeLevelTests };

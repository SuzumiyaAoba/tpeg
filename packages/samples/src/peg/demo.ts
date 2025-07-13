#!/usr/bin/env bun

/**
 * PEG Parser Demo
 *
 * Demonstrates PEG (Parsing Expression Grammar) parsing capabilities
 * This sample shows how to parse a simple PEG grammar itself.
 */

const demoPEGParsing = () => {
  console.log("=== PEG Grammar Parsing ===");

  const pegGrammar = `
# Simple arithmetic grammar
Expression <- Term ('+' Term / '-' Term)*
Term       <- Factor ('*' Factor / '/' Factor)*
Factor     <- '(' Expression ')' / Number
Number     <- [0-9]+
  `;

  console.log("Input PEG Grammar:");
  console.log(pegGrammar);
  console.log();

  try {
    // Note: The actual parsing would depend on the Grammar implementation
    console.log("This is a demonstration of PEG grammar structure.");
    console.log(
      "The actual grammar parsing would be implemented in the Grammar class.",
    );
    console.log();
  } catch (error) {
    console.error("Failed to parse PEG grammar:", error);
  }
};

const demoRuleParsing = () => {
  console.log("=== Individual Rule Parsing ===");

  const rules = [
    "Identifier <- [a-zA-Z_][a-zA-Z0-9_]*",
    "Number <- [0-9]+",
    'String <- "\\"" (!"\\"" .)* "\\""',
    "Whitespace <- [ \\t\\n\\r]*",
  ];

  console.log("Example PEG rules:");
  for (const rule of rules) {
    console.log(`  ${rule}`);
  }
  console.log();

  console.log("These rules demonstrate various PEG constructs:");
  console.log("- Character classes: [a-zA-Z_]");
  console.log("- Repetition: * (zero or more), + (one or more)");
  console.log("- Negation: ! (not predicate)");
  console.log("- Sequence: consecutive patterns");
  console.log("- Choice: / (ordered choice)");
  console.log();
};

const demoComplexExpressions = () => {
  console.log("=== Complex PEG Expressions ===");

  const expressions = [
    'DOT <- "." Spacing',
    'OPEN <- "(" Spacing',
    'CLOSE <- ")" Spacing',
    'Class <- "[" (!"]" Range)* "]" Spacing',
    'Char <- "\\\\" [nrt\'"\\[\\]\\\\] / "\\\\" [0-2][0-7][0-7] / "\\\\" [0-7][0-7]? / !"\\\\" .',
  ];

  console.log("Complex PEG expressions from the parser:");
  for (const expr of expressions) {
    console.log(`  ${expr}`);
  }
  console.log();

  console.log("These expressions show advanced PEG features:");
  console.log("- Escape sequences in character literals");
  console.log("- Character ranges and classes");
  console.log("- Lookahead predicates");
  console.log("- Nested patterns");
  console.log();
};

const demoMetaGrammar = () => {
  console.log("=== PEG Meta-Grammar ===");

  console.log("A PEG grammar can describe itself (meta-grammar):");
  console.log();

  const metaGrammar = `
Grammar    <- Spacing Definition+ EndOfFile
Definition <- Identifier LEFTARROW Expression
Expression <- Sequence (SLASH Sequence)*
Sequence   <- Prefix*
Prefix     <- (AND / NOT)? Suffix
Suffix     <- Primary (QUESTION / STAR / PLUS)?
Primary    <- Identifier !LEFTARROW
            / OPEN Expression CLOSE
            / Literal 
            / Class 
            / DOT
  `;

  console.log(metaGrammar);
  console.log();

  console.log("This meta-grammar defines:");
  console.log("- How PEG rules are structured");
  console.log(
    "- Operator precedence (Primary > Suffix > Prefix > Sequence > Expression)",
  );
  console.log("- The complete syntax of PEG itself");
  console.log();
};

const main = () => {
  console.log("🎯 TPEG PEG Parser Demo\n");

  try {
    demoPEGParsing();
    demoRuleParsing();
    demoComplexExpressions();
    demoMetaGrammar();

    console.log("✅ All demos completed!");
    console.log(
      "\n📖 This demo shows the structure and concepts of PEG grammars.",
    );
    console.log(
      "   The actual parsing implementation is in the Grammar class and related parsers.",
    );
  } catch (error) {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  }
};

if (import.meta.main) {
  main();
}

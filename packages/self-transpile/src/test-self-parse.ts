/**
 * Test script for TPEG self-transpilation
 * 
 * Tests the ability to parse the TPEG self-definition file
 * and generate TypeScript parser code from it.
 */

import { readFileSync } from "fs";
import { parse } from "tpeg-core";
import { grammarDefinition } from "tpeg-parser";
import { selfTranspile } from "./self-transpile";
import type { GrammarDefinition, RuleDefinition } from "tpeg-core";

async function testSelfParse() {
  console.log("🧪 TPEG Self-Transpilation Test");
  console.log("===================================");
  
  try {
    // Read the TPEG self-definition file
    const selfDefinitionPath = "../parser-sample/examples/tpeg-self.tpeg";
    const grammarSource = readFileSync(selfDefinitionPath, "utf-8");
    
    console.log("📖 Reading TPEG self-definition file...");
    console.log(`📄 File size: ${grammarSource.length} characters`);
    console.log(`📄 First 200 characters: ${grammarSource.substring(0, 200)}...`);
    
    // Test direct parsing with tpeg-parser
    console.log("\n🔍 Testing direct parsing with grammarDefinition parser...");
    const parser = parse(grammarDefinition);
    const parseResult = parser(grammarSource);
    
    if (parseResult.success) {
      console.log("✅ Direct parsing successful!");
      const grammar = parseResult.val as GrammarDefinition;
      console.log(`📊 Grammar name: ${grammar.name}`);
      console.log(`📊 Number of rules: ${grammar.rules.length}`);
      console.log(`📊 Number of annotations: ${grammar.annotations.length}`);
      
      // List rule names
      console.log("\n📋 Parsed rules:");
      grammar.rules.forEach((rule: RuleDefinition, index: number) => {
        console.log(`   ${index + 1}. ${rule.name}`);
      });
      
      // Test self-transpilation
      console.log("\n🚀 Testing self-transpilation...");
      const transpileResult = await selfTranspile(grammarSource, {
        targetLanguage: "typescript",
        includeTypes: true,
        optimize: true
      });
      
      if (transpileResult.success) {
        console.log("✅ Self-transpilation successful!");
        console.log(`⏱️  Generation time: ${transpileResult.performance.generationTime.toFixed(2)}ms`);
        console.log(`💾 Memory usage: ${transpileResult.performance.memoryUsage} bytes`);
        console.log(`🧠 Complexity: ${transpileResult.performance.complexity}`);
        
        // Show generated code preview
        const codePreview = transpileResult.code.substring(0, 500);
        console.log(`\n📝 Generated code preview (first 500 chars):`);
        console.log(codePreview + "...");
        
      } else {
        console.log("❌ Self-transpilation failed!");
        console.log(`🚨 Warnings: ${transpileResult.warnings.join(", ")}`);
      }
      
    } else {
      console.log("❌ Direct parsing failed!");
      console.log(`🚨 Error: ${parseResult.error.message}`);
      console.log(`📍 Error details:`, parseResult.error);
    }
    
  } catch (error) {
    console.error("💥 Test failed with exception:", error);
  }
}

// Run the test
testSelfParse().catch(console.error); 
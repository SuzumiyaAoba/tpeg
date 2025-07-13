#!/usr/bin/env bun

import { parseJSON } from "./json";

/**
 * JSON Parser Demo
 *
 * Demonstrates JSON parsing capabilities including:
 * - Basic JSON structures
 * - Nested objects and arrays
 * - Various data types
 * - Edge cases
 */

const demoBasicTypes = () => {
  console.log("=== Basic JSON Types ===");

  const examples = ['"hello world"', "42", "3.14", "true", "false", "null"];

  for (const json of examples) {
    try {
      const result = parseJSON(json);
      console.log(`Input: ${json}`);
      console.log(`Parsed: ${JSON.stringify(result)} (${typeof result})`);
      console.log();
    } catch (error) {
      console.error(`Failed to parse: ${json}`, error);
    }
  }
};

const demoObjects = () => {
  console.log("=== JSON Objects ===");

  const examples = [
    "{}",
    '{"name": "John"}',
    '{"name": "John", "age": 30}',
    '{"person": {"name": "John", "age": 30}, "active": true}',
  ];

  for (const json of examples) {
    try {
      const result = parseJSON(json);
      console.log("Input:", json);
      console.log("Parsed:", result);
      console.log();
    } catch (error) {
      console.error("Failed to parse:", json, error);
    }
  }
};

const demoArrays = () => {
  console.log("=== JSON Arrays ===");

  const examples = [
    "[]",
    "[1, 2, 3]",
    '["a", "b", "c"]',
    '[1, "hello", true, null]',
    "[[1, 2], [3, 4]]",
    '[{"name": "John"}, {"name": "Jane"}]',
  ];

  for (const json of examples) {
    try {
      const result = parseJSON(json);
      console.log("Input:", json);
      console.log("Parsed:", result);
      console.log();
    } catch (error) {
      console.error("Failed to parse:", json, error);
    }
  }
};

const demoComplexStructures = () => {
  console.log("=== Complex JSON Structures ===");

  const complexJson = `{
    "users": [
      {
        "id": 1,
        "name": "John Doe",
        "email": "john@example.com",
        "active": true,
        "scores": [85, 90, 78],
        "metadata": {
          "lastLogin": "2023-12-01T10:30:00Z",
          "preferences": {
            "theme": "dark",
            "notifications": true
          }
        }
      },
      {
        "id": 2,
        "name": "Jane Smith",
        "email": "jane@example.com",
        "active": false,
        "scores": [92, 88, 95],
        "metadata": {
          "lastLogin": null,
          "preferences": {
            "theme": "light",
            "notifications": false
          }
        }
      }
    ],
    "pagination": {
      "page": 1,
      "total": 2,
      "hasNext": false
    }
  }`;

  try {
    console.log("Input JSON:");
    console.log(complexJson);
    console.log();

    const result = parseJSON(complexJson);
    console.log("Parsed structure:");
    console.log(JSON.stringify(result, null, 2));
    console.log();

    // Demonstrate accessing nested data
    if (typeof result === "object" && result !== null && "users" in result) {
      const users = result.users as Array<Record<string, unknown>>;
      console.log("Accessing nested data:");
      const firstUser = users[0] as Record<string, unknown>;
      const secondUser = users[1] as Record<string, unknown>;
      console.log(`First user name: ${firstUser?.name}`);
      const metadata = secondUser?.metadata as Record<string, unknown>;
      const preferences = metadata?.preferences as Record<string, unknown>;
      console.log(`Second user theme: ${preferences?.theme}`);
      console.log();
    }
  } catch (error) {
    console.error("Failed to parse complex JSON:", error);
  }
};

const demoWhitespaceHandling = () => {
  console.log("=== Whitespace Handling ===");

  const examples = [
    '  {"name": "John"}  ',
    `{
      "name": "John",
      "age": 30
    }`,
    "[ 1 , 2 , 3 ]",
  ];

  for (const json of examples) {
    try {
      const result = parseJSON(json);
      console.log(`Input: ${JSON.stringify(json)}`);
      console.log("Parsed:", result);
      console.log();
    } catch (error) {
      console.error(`Failed to parse: ${json}`, error);
    }
  }
};

const demoErrorCases = () => {
  console.log("=== Error Cases ===");

  const invalidExamples = [
    '{name: "John"}', // Missing quotes on key
    '{"name": John}', // Missing quotes on value
    '{"name": "John",}', // Trailing comma
    "[1, 2, 3,]", // Trailing comma in array
    '{"name": "John"', // Unclosed object
    "[1, 2, 3", // Unclosed array
    '"unclosed string', // Unclosed string
    "undefined", // Invalid literal
  ];

  for (const json of invalidExamples) {
    try {
      const result = parseJSON(json);
      console.log(
        `⚠️  Unexpectedly parsed: ${json} -> ${JSON.stringify(result)}`,
      );
    } catch (_error) {
      console.log(`✅ Correctly failed: ${json}`);
    }
    console.log();
  }
};

const main = () => {
  console.log("🎯 TPEG JSON Parser Demo\n");

  try {
    demoBasicTypes();
    demoObjects();
    demoArrays();
    demoComplexStructures();
    demoWhitespaceHandling();
    demoErrorCases();

    console.log("✅ All demos completed!");
  } catch (error) {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  }
};

if (import.meta.main) {
  main();
}

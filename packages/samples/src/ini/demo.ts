#!/usr/bin/env bun

import { formatINI, parseINI } from "./ini";

/**
 * INI Config Parser Demo
 *
 * Demonstrates INI parsing capabilities including:
 * - Global keys and [section] grouping
 * - Whole-line and inline comments
 * - Whitespace tolerance around `=`
 * - Round-tripping through formatINI
 */

const demoBasicINI = () => {
  console.log("=== Basic INI Parsing ===");

  const iniData = `; Application configuration
app_name = tpeg-demo
version = 1.0.0

[server]
host = example.com
port = 8080

[features]
logging = true
metrics = false`;

  console.log("Input INI:");
  console.log(iniData);
  console.log();

  const result = parseINI(iniData);
  console.log("Parsed result:");
  console.log(result);
  console.log();
};

const demoCommentsAndWhitespace = () => {
  console.log("=== Comments and Whitespace ===");

  const iniData = `# Comment style 1
  ; Comment style 2
   spaced_key   =   spaced value   ; inline comment dropped
hash_in_value = a#b stays intact
[section] ; comment after a header
key=compact`;

  console.log("Input INI:");
  console.log(iniData);
  console.log();

  const result = parseINI(iniData);
  console.log("Parsed result:");
  console.log(result);
  console.log();
};

const demoEdgeCases = () => {
  console.log("=== Edge Cases ===");

  // Empty values
  console.log("Empty values and repeated keys:");
  console.log(parseINI("empty =\nkey = first\nkey = last"));
  console.log();

  // Duplicate sections merge
  console.log("A repeated [section] merges into one:");
  console.log(parseINI("[a]\nx = 1\n[b]\ny = 2\n[a]\nz = 3"));
  console.log();

  // CRLF line endings
  console.log("CRLF line endings:");
  console.log(parseINI("[s]\r\na = 1\r\nb = 2\r\n"));
  console.log();
};

const demoRoundTrip = () => {
  console.log("=== Round Trip: parse -> format -> parse ===");

  const iniData = `title = demo

[owner]
name = Alice
email = alice@example.com

[database]
host = db.internal
port = 5432`;

  const first = parseINI(iniData);
  const written = formatINI(first);
  console.log("Serialized INI:");
  console.log(written);

  const second = parseINI(written);
  console.log("Round trip preserves data:");
  console.log(JSON.stringify(first) === JSON.stringify(second));
  console.log();
};

const demoErrors = () => {
  console.log("=== Error Handling ===");

  const malformed = "[unclosed section\nkey = value";

  console.log("Malformed input:");
  console.log(malformed);
  try {
    parseINI(malformed);
    console.log("Unexpectedly parsed!");
  } catch (error) {
    console.log(`Rejected: ${(error as Error).message}`);
  }
  console.log();
};

const main = () => {
  console.log("🎯 TPEG INI Parser Demo\n");

  try {
    demoBasicINI();
    demoCommentsAndWhitespace();
    demoEdgeCases();
    demoRoundTrip();
    demoErrors();

    console.log("✅ All demos completed successfully!");
  } catch (error) {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  }
};

if (import.meta.main) {
  main();
}

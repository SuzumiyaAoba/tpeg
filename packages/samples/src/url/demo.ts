#!/usr/bin/env bun

import { parseQueryParams, parseUrl } from "./url";

/**
 * URL Parser Demo
 *
 * Demonstrates structured decomposition of absolute URLs:
 * - scheme, userinfo, host, port, path, query, fragment
 * - Optional components omitted from the result
 * - `commit` keeping a malformed authority a hard error
 * - Query-string decoding with parseQueryParams
 */

const demoBasicUrls = () => {
  console.log("=== Basic URL Parsing ===");

  const urls = [
    "https://example.com/path/to/page?q=search&lang=en#section",
    "http://localhost:8080/api/v1",
    "ftp://files.example.org/pub/readme.txt",
  ];

  for (const url of urls) {
    console.log(`Input:  ${url}`);
    console.log("Parsed:", parseUrl(url));
    console.log();
  }
};

const demoAuthorityParts = () => {
  console.log("=== Authority: userinfo and port ===");

  const urls = [
    "https://user:secret@example.com:8443/secure",
    "ssh://git@github.com/repo.git",
    "https://example.com",
  ];

  for (const url of urls) {
    console.log(`Input:  ${url}`);
    console.log("Parsed:", parseUrl(url));
    console.log();
  }
};

const demoOpaqueUrls = () => {
  console.log("=== URLs without a // authority ===");

  const urls = ["mailto:user@example.com", "urn:isbn:9780132350884"];

  for (const url of urls) {
    console.log(`Input:  ${url}`);
    console.log("Parsed:", parseUrl(url));
    console.log();
  }
};

const demoQueryParams = () => {
  console.log("=== Query Parameter Decoding ===");

  const url = "https://example.com/search?q=hello+world&page=2&tag=a%2Cb&empty";
  const parsed = parseUrl(url);

  console.log(`Input:  ${url}`);
  console.log("Parsed:", parsed);
  console.log("Query params:", parseQueryParams(parsed.query ?? ""));
  console.log();
};

const demoErrors = () => {
  console.log("=== Error Handling ===");

  for (const input of ["://no-scheme", "x://host:abc", "x://", "not a url"]) {
    try {
      const parsed = parseUrl(input);
      console.log(`  ${JSON.stringify(input)} ->`, parsed);
    } catch (error) {
      console.log(`  ${JSON.stringify(input)} -> ${(error as Error).message}`);
    }
  }
  console.log();
};

const main = () => {
  console.log("🎯 TPEG URL Parser Demo\n");

  try {
    demoBasicUrls();
    demoAuthorityParts();
    demoOpaqueUrls();
    demoQueryParams();
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

#!/usr/bin/env bun

import { arrayToCSV, parseCSV, parseCSVWithHeaders } from "./csv";

/**
 * CSV Parser Demo
 *
 * Demonstrates CSV parsing capabilities including:
 * - Basic CSV parsing
 * - Quoted fields with escaping
 * - Header-based object parsing
 * - CSV generation from objects
 */

const demoBasicCSV = () => {
  console.log("=== Basic CSV Parsing ===");

  const csvData = `name,age,city
John,30,New York
Jane,25,Boston
Bob,40,Chicago`;

  console.log("Input CSV:");
  console.log(csvData);
  console.log();

  const result = parseCSV(csvData);
  console.log("Parsed result:");
  console.log(result);
  console.log();
};

const demoQuotedFields = () => {
  console.log("=== Quoted Fields with Escaping ===");

  const csvData = `name,description,price
"Product A","A ""great"" product with, commas",29.99
"Product B","Simple product",19.99
"Product C","Multi-line
description",39.99`;

  console.log("Input CSV:");
  console.log(csvData);
  console.log();

  const result = parseCSV(csvData);
  console.log("Parsed result:");
  console.log(result);
  console.log();
};

const demoHeaderParsing = () => {
  console.log("=== Header-based Object Parsing ===");

  const csvData = `name,age,city,active
John,30,New York,true
Jane,25,Boston,false
Bob,40,Chicago,true`;

  console.log("Input CSV:");
  console.log(csvData);
  console.log();

  const result = parseCSVWithHeaders(csvData);
  console.log("Parsed as objects:");
  console.log(result);
  console.log();
};

const demoCSVGeneration = () => {
  console.log("=== CSV Generation from Objects ===");

  const data = [
    { name: "Alice", age: 28, city: "Seattle", active: true },
    { name: "Bob", age: 35, city: "Portland", active: false },
    { name: "Carol", age: 42, city: "San Francisco", active: true },
  ];

  console.log("Input objects:");
  console.log(data);
  console.log();

  const csvResult = arrayToCSV(data);
  console.log("Generated CSV:");
  console.log(csvResult);
  console.log();
};

const demoEdgeCases = () => {
  console.log("=== Edge Cases ===");

  // Empty fields
  const csvWithEmpties = `name,middle,last
John,,Doe
Jane,Mary,Smith
,,`;

  console.log("CSV with empty fields:");
  console.log(csvWithEmpties);
  console.log("Parsed:");
  console.log(parseCSV(csvWithEmpties));
  console.log();

  // Single field
  const singleField = `name
John
Jane
Bob`;

  console.log("Single column CSV:");
  console.log(singleField);
  console.log("Parsed:");
  console.log(parseCSV(singleField));
  console.log();
};

const main = () => {
  console.log("🎯 TPEG CSV Parser Demo\n");

  try {
    demoBasicCSV();
    demoQuotedFields();
    demoHeaderParsing();
    demoCSVGeneration();
    demoEdgeCases();

    console.log("✅ All demos completed successfully!");
  } catch (error) {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  }
};

if (import.meta.main) {
  main();
}

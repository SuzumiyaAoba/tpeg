import { describe, expect, it } from "vite-plus/test";
import { transformWithOxc } from "vite-plus";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Expression,
  createActionExpression,
  createCharacterClass,
  createCharRange,
  createChoice,
  createGrammarDefinition,
  createLabeledExpression,
  createOptional,
  createPositiveLookahead,
  createRuleDefinition,
  createSequence,
  createStar,
  createStringLiteral,
} from "@suzumiyaaoba/tpeg-core";
import { TypeIntegrationEngine } from "./type-integration";
import { TypeInferenceEngine } from "./type-inference";

function generateDefinitions(
  pattern: Expression,
  typeNamespace = "",
  customTypeMappings = new Map<string, string>(),
) {
  const engine = new TypeIntegrationEngine({
    generateTypeGuards: true,
    includeDocumentation: false,
    typeNamespace,
    customTypeMappings,
  });
  const grammar = createGrammarDefinition(
    "GuardTest",
    [],
    [createRuleDefinition("start", pattern)],
  );
  return engine.createTypedGrammar(grammar).typeDefinitions;
}

async function compileModule(definitions: string) {
  const { code } = await transformWithOxc(definitions, "generated-guards.ts");
  return await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
}

async function compileGuard(
  pattern: Expression,
  typeNamespace = "",
  customTypeMappings = new Map<string, string>(),
) {
  const definitions = generateDefinitions(
    pattern,
    typeNamespace,
    customTypeMappings,
  );
  return guardExport(await compileModule(definitions), typeNamespace);
}

function guardExport(exported: unknown, typeNamespace: string) {
  for (const name of [
    ...(typeNamespace ? typeNamespace.split(".") : []),
    "isStartResult",
  ]) {
    exported = (exported as Record<string, unknown>)[name];
  }
  return exported as (value: unknown) => boolean;
}

const literal = (value: string) => createStringLiteral(value, '"');
const labeled = (label: string, expression: Expression) =>
  createLabeledExpression(label, expression);
const mappedShapes = [
  [createStar(literal("a")), '"a"[]'],
  [createChoice([literal("a"), literal("b")]), '"a" | "b"'],
  [labeled("value", literal("a")), '{ value: "a" }'],
] as const;
const mappedValues = [
  undefined,
  null,
  false,
  0,
  Number.NaN,
  1n,
  Symbol("value"),
  "",
  "a",
  {},
  [],
  () => {},
] as const;
const primitiveMappings = [
  ["unknown", mappedValues.map((_, index) => index)],
  ["any", mappedValues.map((_, index) => index)],
  ["never", []],
  ["void", [0]],
  ["undefined", [0]],
  ["null", [1]],
  ["boolean", [2]],
  ["number", [3, 4]],
  ["bigint", [5]],
  ["symbol", [6]],
  ["string", [7, 8]],
  ["object", [9, 10, 11]],
] as const;
const prototypeTargets = [
  ["constructor", Object as object],
  ["__proto__", Object.prototype as object],
  ...["toString", "hasOwnProperty"].map(
    (name) =>
      [
        name,
        Object.getOwnPropertyDescriptor(Object.prototype, name)
          ?.value as object,
      ] as const,
  ),
] as const;

async function compileAndLoadDefinitions(
  definitions: string[],
  compilerFlags: readonly string[] = [],
) {
  const dir = mkdtempSync(join(tmpdir(), "tpeg-generated-guards-"));
  try {
    const paths = definitions.map((definition, index) => {
      const path = join(dir, `guards-${index}.ts`);
      writeFileSync(path, definition);
      return path;
    });
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
        ),
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--outDir",
        join(dir, "compiled"),
        ...paths,
        ...compilerFlags,
      ],
      { cwd: dir, timeout: 15_000, encoding: "utf8" },
    );
    expect(
      result.status,
      result.stdout || result.stderr || result.error?.message,
    ).toBe(0);
    const modules: unknown[] = [];
    for (let index = 0; index < paths.length; index++) {
      const code = readFileSync(
        join(dir, "compiled", `guards-${index}.js`),
        "utf8",
      );
      modules.push(
        await import(
          /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
        ),
      );
    }
    return modules;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("generated type guards at runtime", () => {
  for (const [pattern, typeString] of mappedShapes) {
    it.each(primitiveMappings)(
      `validates a mapping from ${typeString} to %s using the mapped type`,
      async (mapped, accepted) => {
        const guard = await compileGuard(
          pattern,
          "Array",
          new Map([[typeString, mapped]]),
        );
        for (const [index, value] of mappedValues.entries()) {
          expect(guard(value), `${mapped}: candidate ${index}`).toBe(
            (accepted as readonly number[]).includes(index),
          );
        }
      },
    );

    it.each([
      ['"changed"', "changed"],
      ["'a\"b'", 'a"b'],
      ['"a\\\\b"', "a\\b"],
      [' " spaced " ', " spaced "],
    ])(
      `checks a string literal mapping from ${typeString} to %s`,
      async (mapped, expected) => {
        const guard = await compileGuard(
          pattern,
          "Array",
          new Map([[typeString, mapped]]),
        );
        for (const value of [expected, "a", {}, [], undefined, null]) {
          expect(guard(value)).toBe(value === expected);
        }
      },
    );

    it.each([
      "Custom",
      "Namespace.Custom",
      "string[]",
      "string | null",
      "{ value: string }",
      "ReadonlyArray<string>",
    ])(
      `rejects an unavailable runtime shape when mapping ${typeString} to %s`,
      (mapped) => {
        expect(() =>
          generateDefinitions(pattern, "", new Map([[typeString, mapped]])),
        ).toThrow(/Cannot generate a type guard for custom type mapping/);
        expect(() =>
          generateDefinitions(pattern, "", new Map([[typeString, mapped]])),
        ).toThrow(/Disable generateTypeGuards and provide your own validator/);
      },
    );
  }

  it.each([
    createStar(literal("a")),
    labeled("value", literal("a")),
    createOptional(literal("a")),
  ])("rejects an unavailable mapped type inside a nested shape", (pattern) => {
    expect(() =>
      generateDefinitions(pattern, "", new Map([['"a"', "Custom"]])),
    ).toThrow(/Cannot generate a type guard for custom type mapping/);
  });

  it("retains runtime shape metadata for identity mappings", async () => {
    const values = [["a"], "a", { value: "a" }];
    for (const [index, [pattern, typeString]] of mappedShapes.entries()) {
      const guard = await compileGuard(
        pattern,
        "Array",
        new Map([[typeString, typeString]]),
      );
      expect(guard(values[index])).toBe(true);
      expect(guard(undefined)).toBe(false);
    }
  });

  it("preserves arbitrary mappings when generating type definitions without guards", async () => {
    const definitions = mappedShapes.flatMap(([pattern, typeString]) =>
      [
        "Custom",
        "Namespace.Custom",
        "string[]",
        "string | null",
        "{ value: string }",
        "ReadonlyArray<string>",
      ].map((mapped) => {
        const engine = new TypeIntegrationEngine({
          customTypeMappings: new Map([[typeString, mapped]]),
        });
        const grammar = createGrammarDefinition(
          "G",
          [],
          [createRuleDefinition("start", pattern)],
        );
        const { typeDefinitions } = engine.createTypedGrammar(grammar);
        expect(typeDefinitions).toContain(`StartResult = ${mapped};`);
        expect(typeDefinitions).not.toContain("function isStartResult");
        return `export type Custom = string;
export namespace Namespace { export type Custom = string; }
${typeDefinitions}`;
      }),
    );
    await compileAndLoadDefinitions(definitions, ["--noUnusedLocals"]);
  });

  it("agrees with TypeScript about nullability of builtin mappings", async () => {
    const definitions = mappedShapes.flatMap(([pattern, typeString]) =>
      primitiveMappings.map(([mapped]) => {
        const engine = new TypeIntegrationEngine({
          generateTypeGuards: true,
          includeDocumentation: false,
          customTypeMappings: new Map([[typeString, mapped]]),
        });
        const grammar = createGrammarDefinition(
          "G",
          [],
          [createRuleDefinition("start", pattern)],
        );
        const typed = engine.createTypedGrammar(grammar);
        const inferred = typed.typeInference.ruleTypes.get("start")!;
        expect(inferred.isArray).toBe(false);
        expect(inferred.arrayElement).toBeUndefined();
        expect(inferred.tupleMembers).toBeUndefined();
        expect(inferred.unionMembers).toBeUndefined();
        expect(inferred.objectProperties).toBeUndefined();
        return `${typed.typeDefinitions}
type Nullable = null extends StartResult ? true : undefined extends StartResult ? true : false;
export const reportedNullable: Nullable = ${inferred.nullable};`;
      }),
    );
    await compileAndLoadDefinitions(definitions, ["--noUnusedLocals"]);
  });

  it("agrees with TypeScript about inferred nullability beyond optional expressions", async () => {
    const unknown = createActionExpression(literal("a"), "return undefined;");
    const expressions = [
      unknown,
      createPositiveLookahead(literal("a")),
      createChoice([literal("a"), createOptional(literal("b"))]),
      createChoice([literal("a"), unknown]),
      createChoice([literal("a"), createPositiveLookahead(literal("b"))]),
      createStar(unknown),
      labeled("value", unknown),
      createSequence([unknown, literal("b")]),
      createChoice([]),
    ];
    const definitions = expressions.map((expression) => {
      const engine = new TypeInferenceEngine();
      const inferred = engine.inferExpressionType(expression);
      return `export type Value = ${inferred.typeString};
type Nullable = null extends Value ? true : undefined extends Value ? true : false;
export const reportedNullable: Nullable = ${inferred.nullable};`;
    });
    await compileAndLoadDefinitions(definitions, ["--noUnusedLocals"]);
  });

  it("compiles guards for primitive mappings without unused Array aliases", async () => {
    const definitions = mappedShapes.flatMap(([pattern, typeString]) =>
      primitiveMappings.map(([mapped]) =>
        generateDefinitions(pattern, "Array", new Map([[typeString, mapped]])),
      ),
    );
    const modules = await compileAndLoadDefinitions(definitions, [
      "--noUnusedLocals",
      "--noUnusedParameters",
    ]);
    for (const [index, module] of modules.entries()) {
      const [, accepted] = primitiveMappings[index % primitiveMappings.length]!;
      const guard = guardExport(module, "Array");
      for (const [valueIndex, value] of mappedValues.entries()) {
        expect(guard(value), `compiled mapping ${index}: ${valueIndex}`).toBe(
          (accepted as readonly number[]).includes(valueIndex),
        );
      }
    }
  });

  it.each(["a", "b"])(
    "reads a literal tuple member once when its first value is %s",
    async (first) => {
      const guard = await compileGuard(
        createSequence([literal("a"), literal("b")]),
      );
      let reads = 0;
      const value = ["a", "b"];
      Object.defineProperty(value, "0", {
        get() {
          return ++reads === 1 ? first : "a";
        },
      });
      expect(guard(value)).toBe(first === "a");
      expect(reads).toBe(1);
    },
  );

  it("does not replace a tuple member while checking a union", async () => {
    const guard = await compileGuard(
      createSequence([
        createChoice([literal("a"), literal("b")]),
        literal("c"),
      ]),
    );
    let reads = 0;
    const value = ["a", "c"];
    Object.defineProperty(value, "0", {
      get() {
        return ++reads === 1 ? 1 : "b";
      },
    });
    expect(guard(value)).toBe(false);
    expect(reads).toBe(1);
  });

  it("keeps a nested tuple value stable throughout its checks", async () => {
    const guard = await compileGuard(
      createSequence([
        createSequence([literal("a"), literal("b")]),
        literal("c"),
      ]),
    );
    let reads = 0;
    const value: unknown[] = [["a", "b"], "c"];
    Object.defineProperty(value, "0", {
      get() {
        return ++reads === 1 ? ["a", "b"] : undefined;
      },
    });
    expect(guard(value)).toBe(true);
    expect(reads).toBe(1);
  });

  it("keeps an optional captured tuple member stable throughout its checks", async () => {
    const guard = await compileGuard(
      createSequence([
        createOptional(labeled("value", literal("a"))),
        literal("b"),
      ]),
    );
    let reads = 0;
    const value: unknown[] = [{ value: "a" }, "b"];
    Object.defineProperty(value, "0", {
      get() {
        return ++reads === 1 ? { value: "a" } : null;
      },
    });
    expect(guard(value)).toBe(true);
    expect(reads).toBe(1);
  });

  it("does not read later tuple slots after rejecting an earlier member", async () => {
    const guard = await compileGuard(
      createSequence([literal("a"), literal("b")]),
    );
    const value = ["wrong", "b"];
    Object.defineProperty(value, "1", {
      get() {
        throw new Error("unused later slot");
      },
    });
    expect(guard(value)).toBe(false);
  });

  it("does not read an unknown tuple member", async () => {
    const guard = await compileGuard(
      createSequence([
        createActionExpression(literal("a"), "return undefined;"),
        literal("b"),
      ]),
    );
    const value = [undefined, "b"];
    Object.defineProperty(value, "0", {
      get() {
        throw new Error("unused unknown slot");
      },
    });
    expect(guard(value)).toBe(true);
  });

  it("does not visit the elements of an unknown array", async () => {
    const guard = await compileGuard(
      createStar(createActionExpression(literal("a"), "return undefined;")),
    );
    const value = [undefined];
    Object.defineProperty(value, "0", {
      get() {
        throw new Error("unused unknown element");
      },
    });
    expect(guard(value)).toBe(true);
    expect(guard([])).toBe(true);
    expect(guard({})).toBe(false);
  });

  it("rejects a nonempty never array without reading its elements", async () => {
    const guard = await compileGuard(createStar(createChoice([])));
    const value = [undefined];
    Object.defineProperty(value, "0", {
      get() {
        throw new Error("unused never element");
      },
    });
    expect(guard(value)).toBe(false);
    expect(guard([])).toBe(true);
    expect(guard({})).toBe(false);
  });

  it("requires an unknown capture property without reading its value", async () => {
    const guard = await compileGuard(
      labeled(
        "value",
        createActionExpression(literal("a"), "return undefined;"),
      ),
    );
    const value = {
      get value() {
        throw new Error("unused unknown property");
      },
    };
    expect(guard(value)).toBe(true);
    expect(guard({})).toBe(false);
  });

  it("rejects an impossible captured type without reading any property", async () => {
    const guard = await compileGuard(
      createSequence([
        labeled("first", literal("a")),
        labeled("impossible", createChoice([])),
      ]),
    );
    const value = {
      get first() {
        throw new Error("unused earlier property");
      },
      get impossible() {
        throw new Error("unused impossible property");
      },
    };
    expect(guard(value)).toBe(false);
    expect(guard({})).toBe(false);
  });

  it.each(["first", "last"])(
    "does not inspect a union with an unknown %s member",
    async (position) => {
      const unknown = createActionExpression(literal("b"), "return undefined;");
      const array = createStar(literal("a"));
      const pattern = createChoice(
        position === "first" ? [unknown, array] : [array, unknown],
      );
      const guard = await compileGuard(pattern, "Array");
      const value = [undefined];
      Object.defineProperty(value, "0", {
        get() {
          throw new Error("unused union element");
        },
      });
      expect(guard(value)).toBe(true);
      expect(guard(undefined)).toBe(true);
      expect(guard({})).toBe(true);
    },
  );

  it("propagates an unknown nested union without inspecting its array alternative", async () => {
    const guard = await compileGuard(
      createChoice([
        createStar(literal("a")),
        createChoice([
          literal("b"),
          createActionExpression(literal("c"), "return undefined;"),
        ]),
      ]),
    );
    const value = [undefined];
    Object.defineProperty(value, "0", {
      get() {
        throw new Error("unused nested union element");
      },
    });
    expect(guard(value)).toBe(true);
  });

  it("compiles constant guards without unused aliases for a shadowed Array", async () => {
    const unknown = createActionExpression(literal("b"), "return undefined;");
    const array = createStar(literal("a"));
    const impossible = createChoice([]);
    const definitions = [
      createChoice([array, unknown]),
      createChoice([unknown, array]),
      createChoice([array, createChoice([literal("c"), unknown])]),
      createSequence([array, impossible]),
      createSequence([labeled("first", array), labeled("last", impossible)]),
    ].map((pattern) => generateDefinitions(pattern, "Array"));
    await compileAndLoadDefinitions(definitions, [
      "--noUnusedLocals",
      "--noUnusedParameters",
    ]);
  });

  it("compiles and loads generated guards for nested objects, arrays, tuples and optional fields", async () => {
    const pattern = createSequence([
      labeled(
        "items",
        createStar(
          labeled(
            "entry",
            createSequence([
              labeled("name", literal("x")),
              labeled("pair", createSequence([literal("a"), literal("b")])),
            ]),
          ),
        ),
      ),
      labeled("maybe", createOptional(labeled("__proto__", literal("x")))),
    ]);
    await compileAndLoadDefinitions([
      generateDefinitions(pattern),
      generateDefinitions(pattern, "Record"),
    ]);
  });

  const arrayNamespaces = [
    "Array",
    "Types.Array",
    "Array.globalThis",
    "globalThis.Array",
    "__tpegArray.Array",
    "__tpegArray.__tpegArray_.Array",
  ];

  it("compiles and loads guards when namespaces shadow built-ins or use contextual names", async () => {
    const pattern = createSequence([
      labeled("items", createStar(literal("a"))),
      labeled("assertion", createPositiveLookahead(literal("a"))),
    ]);
    await compileAndLoadDefinitions(
      [
        ...arrayNamespaces,
        "undefined",
        "Types.undefined",
        "async",
        "Types.of",
      ].map((name) => generateDefinitions(pattern, name)),
    );
  });

  it("compiles and loads type-only namespaces whose names cannot be runtime bindings", async () => {
    const definitions = [
      "await",
      "eval",
      "arguments",
      "Types.await",
      "Types.eval",
      "Types.arguments",
      "Types.class",
      "Types.default",
      "Types.true",
      "Types.const",
      "Types.class.More",
    ].map((typeNamespace) => {
      const engine = new TypeIntegrationEngine({ typeNamespace });
      const grammar = createGrammarDefinition(
        "InterfaceTest",
        [],
        [createRuleDefinition("start", literal("a"))],
      );
      const typedGrammar = engine.createTypedGrammar(grammar);
      // Interfaces stay type-only even if the engine also offers runtime guards.
      const interfaceEngine = new TypeIntegrationEngine({
        typeNamespace,
        generateTypeGuards: true,
      });
      const parserInterface = interfaceEngine
        .generateParserInterface(typedGrammar)
        .replace(
          '"@suzumiyaaoba/tpeg-core"',
          JSON.stringify(
            fileURLToPath(new URL("../../core/dist/index.js", import.meta.url)),
          ),
        );
      return `${typedGrammar.typeDefinitions}\n${parserInterface}`;
    });
    await compileAndLoadDefinitions(definitions);
  });

  it("does not emit a runtime namespace for a grammar with no guards to generate", async () => {
    const engine = new TypeIntegrationEngine({
      typeNamespace: "Types.class",
      generateTypeGuards: true,
    });
    const grammar = createGrammarDefinition("Empty", [], []);
    await compileAndLoadDefinitions([
      engine.createTypedGrammar(grammar).typeDefinitions,
    ]);
  });

  it.each(["async", "Types.of", "Types.type", "Types.constructor"])(
    "loads guards in the contextual namespace %s as an ES module",
    async (name) => {
      const guard = await compileGuard(literal("a"), name);
      expect(guard("a")).toBe(true);
      expect(guard("b")).toBe(false);
    },
  );

  it.each(prototypeTargets)(
    "does not mutate inherited objects when initializing Types.%s",
    async (name, target) => {
      const before = Object.getOwnPropertyDescriptor(target, "isStartResult");
      try {
        const guard = await compileGuard(
          literal(`safe-${name}`),
          `Types.${name}`,
        );
        expect(guard(`safe-${name}`)).toBe(true);
        expect(guard("other")).toBe(false);
        expect(
          Object.getOwnPropertyDescriptor(target, "isStartResult"),
        ).toEqual(before);
      } finally {
        if (before) Object.defineProperty(target, "isStartResult", before);
        else Reflect.deleteProperty(target, "isStartResult");
      }
    },
  );

  it.each([
    "Object.__proto__",
    "globalThis.__proto__",
    "__tpegObject.__tpegObject_.__proto__",
    "Types.__proto__.constructor",
  ])(
    "initializes nested prototype names in %s without modifying global objects",
    async (name) => {
      const targets = [Object, Object.prototype as object];
      const before = targets.map((target) =>
        Object.getOwnPropertyDescriptor(target, "isStartResult"),
      );
      try {
        const guard = await compileGuard(literal(`safe-${name}`), name);
        expect(guard(`safe-${name}`)).toBe(true);
        expect(guard("other")).toBe(false);
        expect(
          targets.map((target) =>
            Object.getOwnPropertyDescriptor(target, "isStartResult"),
          ),
        ).toEqual(before);
      } finally {
        targets.forEach((target, index) => {
          const descriptor = before[index];
          if (descriptor)
            Object.defineProperty(target, "isStartResult", descriptor);
          else Reflect.deleteProperty(target, "isStartResult");
        });
      }
    },
  );

  it("preserves an existing own namespace value when adding its guards", async () => {
    const definitions = `
      export namespace Types {
        export function constructor() { return "existing"; }
      }
      ${generateDefinitions(literal("a"), "Types.constructor")}
    `;
    const modules = [
      await compileModule(definitions),
      ...(await compileAndLoadDefinitions([definitions])),
    ] as {
      Types: {
        constructor: (() => string) & {
          isStartResult: (value: unknown) => boolean;
        };
      };
    }[];
    for (const module of modules) {
      expect(module.Types.constructor()).toBe("existing");
      expect(module.Types.constructor.isStartResult("a")).toBe(true);
      expect(module.Types.constructor.isStartResult("b")).toBe(false);
    }
  });

  it("loads TypeScript compiler output without mutating inherited namespace objects", async () => {
    const names = [
      "Types.constructor",
      "Types.__proto__",
      "Types.toString",
      "Types.hasOwnProperty",
      "Object.__proto__",
      "globalThis.__proto__",
      "__tpegObject.__tpegObject_.__proto__",
      "Types.__proto__.constructor",
    ];
    const targets = prototypeTargets.map(([, target]) => target);
    const before = targets.map((target) =>
      Object.getOwnPropertyDescriptor(target, "isStartResult"),
    );
    try {
      const modules = await compileAndLoadDefinitions(
        names.map((name) =>
          generateDefinitions(literal(`native-${name}`), name),
        ),
      );
      modules.forEach((module, index) => {
        const name = names[index] as string;
        const guard = guardExport(module, name);
        expect(guard(`native-${name}`)).toBe(true);
        expect(guard("other")).toBe(false);
      });
      expect(
        targets.map((target) =>
          Object.getOwnPropertyDescriptor(target, "isStartResult"),
        ),
      ).toEqual(before);
    } finally {
      targets.forEach((target, index) => {
        const descriptor = before[index];
        if (descriptor)
          Object.defineProperty(target, "isStartResult", descriptor);
        else Reflect.deleteProperty(target, "isStartResult");
      });
    }
  });

  it("compiles and loads parser interfaces when a namespace shares the imported ParseResult name", async () => {
    const definitions = ["ParseResult", "ParseResult.Types"].map(
      (typeNamespace) => {
        const engine = new TypeIntegrationEngine({ typeNamespace });
        const grammar = createGrammarDefinition(
          "InterfaceTest",
          [],
          [createRuleDefinition("start", literal("a"))],
        );
        const typedGrammar = engine.createTypedGrammar(grammar);
        // Resolve the real core declarations from the temporary compiler fixture.
        const parserInterface = engine
          .generateParserInterface(typedGrammar)
          .replace(
            '"@suzumiyaaoba/tpeg-core"',
            JSON.stringify(
              fileURLToPath(
                new URL("../../core/dist/index.js", import.meta.url),
              ),
            ),
          );
        return `${typedGrammar.typeDefinitions}\n${parserInterface}`;
      },
    );
    await compileAndLoadDefinitions(definitions);
  });

  it.each(arrayNamespaces)(
    "checks arrays inside the %s namespace",
    async (name) => {
      const guard = await compileGuard(createStar(literal("a")), name);
      expect(guard(["a"])).toBe(true);
      expect(guard([1])).toBe(false);
      expect(guard("a")).toBe(false);
    },
  );

  it.each(["undefined", "Types.undefined"])(
    "checks void results inside the %s namespace",
    async (name) => {
      const guard = await compileGuard(
        createPositiveLookahead(literal("a")),
        name,
      );
      expect(guard(undefined)).toBe(true);
      expect(guard(null)).toBe(false);
      expect(guard({})).toBe(false);
    },
  );

  it("validates elements independently of an array's overridden findIndex", async () => {
    const guard = await compileGuard(createStar(literal("a")));
    expect(guard(Object.assign([1], { findIndex: () => -1 }))).toBe(false);
    expect(guard(Object.assign(["a"], { findIndex: () => 0 }))).toBe(true);
  });

  it("checks a labeled result's required property and its value", async () => {
    const guard = await compileGuard(labeled("value", literal("x")));
    expect(guard({ value: "x" })).toBe(true);
    for (const value of [{}, { value: 1 }, { value: "y" }, [], null]) {
      expect(guard(value)).toBe(false);
    }
    expect(guard(Object.create({ value: "x" }))).toBe(true);
  });

  it("accepts functions carrying the properties of a structural object type", async () => {
    const guard = await compileGuard(labeled("value", literal("x")));
    expect(guard(Object.assign(() => undefined, { value: "x" }))).toBe(true);
    expect(guard(Object.assign(() => undefined, { value: "y" }))).toBe(false);
    expect(guard(() => undefined)).toBe(false);
  });

  it("checks all merged labels and uses the last duplicate label's type", async () => {
    const guard = await compileGuard(
      createSequence([
        labeled("value", literal("a")),
        labeled("kind", literal("b")),
        labeled("value", literal("c")),
      ]),
    );
    expect(guard({ value: "c", kind: "b" })).toBe(true);
    expect(guard({ value: "a", kind: "b" })).toBe(false);
    expect(guard({ value: "c" })).toBe(false);
    expect(guard({ value: "c", kind: 3 })).toBe(false);
  });

  it("checks nested labeled values and arrays of labeled values", async () => {
    const guard = await compileGuard(
      labeled(
        "items",
        createStar(
          labeled("name", createCharacterClass([createCharRange("a")])),
        ),
      ),
    );
    expect(guard({ items: [{ name: "a" }] })).toBe(true);
    expect(guard({ items: [] })).toBe(true);
    expect(guard({ items: [{}] })).toBe(false);
    expect(guard({ items: [{ name: 1 }] })).toBe(false);
    expect(guard({ items: "a" })).toBe(false);
  });

  it("accepts null for an optional labeled value but validates a present value", async () => {
    const guard = await compileGuard(
      createOptional(labeled("value", literal("x"))),
    );
    expect(guard(null)).toBe(true);
    expect(guard({ value: "x" })).toBe(true);
    expect(guard({})).toBe(false);
    expect(guard(undefined)).toBe(false);
  });

  it("accepts undefined as a valid unknown semantic action result", async () => {
    const guard = await compileGuard(
      createActionExpression(literal("x"), "return undefined;"),
    );
    for (const value of [undefined, null, "x", 1, {}, [], Symbol("x")]) {
      expect(guard(value)).toBe(true);
    }
  });

  it("requires a labeled unknown property even when its value is undefined", async () => {
    const guard = await compileGuard(
      labeled(
        "value",
        createActionExpression(literal("x"), "return undefined;"),
      ),
    );
    expect(guard({ value: undefined })).toBe(true);
    expect(guard({})).toBe(false);
  });

  it("checks sparse array entries rather than skipping holes", async () => {
    const guard = await compileGuard(createStar(literal("a")));
    expect(guard([])).toBe(true);
    expect(guard(["a"])).toBe(true);
    const sparse: string[] = [];
    sparse.length = 1;
    expect(guard(sparse)).toBe(false);
  });

  it.each(["__proto__", 'quoted"key\n', "日本語😀"])(
    "escapes property names in generated guards: %s",
    async (label) => {
      const guard = await compileGuard(labeled(label, literal("x")));
      expect(guard({ [label]: "x" })).toBe(true);
      expect(guard({ [label]: "y" })).toBe(false);
      expect(guard({})).toBe(false);
    },
  );
});

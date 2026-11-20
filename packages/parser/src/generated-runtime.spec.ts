import { describe, expect, it } from "vite-plus/test";
import { evaluateGeneratedModule } from "./generated-runtime";

const sourceKey = Symbol.for(
  "@suzumiyaaoba/tpeg-parser/native-evaluation-source",
);
const outcomes = [
  { name: "success", code: "export const start = 7;", error: undefined },
  {
    name: "syntax failure",
    code: "export const start = (;",
    error: SyntaxError,
  },
  {
    name: "initialization failure",
    code: 'export const start = (() => { throw new Error("init"); })();',
    error: "init",
  },
];

function expectOutcome(
  code: string,
  error: typeof SyntaxError | string | undefined,
) {
  if (error === undefined) {
    expect(evaluateGeneratedModule(code, {})["start"]).toBe(7);
  } else {
    expect(() => evaluateGeneratedModule(code, {})).toThrow(error);
  }
}

describe("generated evaluator preserves global state", () => {
  it.each(outcomes)(
    "removes its temporary source after $name",
    ({ code, error }) => {
      const previous = Object.getOwnPropertyDescriptor(globalThis, sourceKey);
      Reflect.deleteProperty(globalThis, sourceKey);
      try {
        expectOutcome(code, error);
        expect(Object.hasOwn(globalThis, sourceKey)).toBe(false);
      } finally {
        if (previous) Object.defineProperty(globalThis, sourceKey, previous);
      }
    },
  );

  it.each(outcomes)(
    "restores a preexisting descriptor after $name",
    ({ code, error }) => {
      const previous = Object.getOwnPropertyDescriptor(globalThis, sourceKey);
      const descriptor = {
        value: "caller-owned",
        enumerable: true,
        configurable: true,
        writable: false,
      };
      Object.defineProperty(globalThis, sourceKey, descriptor);
      try {
        expectOutcome(code, error);
        expect(Object.getOwnPropertyDescriptor(globalThis, sourceKey)).toEqual(
          descriptor,
        );
      } finally {
        if (previous) Object.defineProperty(globalThis, sourceKey, previous);
        else Reflect.deleteProperty(globalThis, sourceKey);
      }
    },
  );

  it("restores global state before reading helper getters and running initializers", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, sourceKey);
    const scope = {
      get helper() {
        expect(Object.getOwnPropertyDescriptor(globalThis, sourceKey)).toEqual(
          previous,
        );
        return () => {
          expect(
            Object.getOwnPropertyDescriptor(globalThis, sourceKey),
          ).toEqual(previous);
          return 7;
        };
      },
    };
    expect(
      evaluateGeneratedModule("export const start = helper();", scope)["start"],
    ).toBe(7);
  });

  it("keeps reentrant compilation independent of the outer factory", () => {
    const scope = {
      get helper() {
        const nested = evaluateGeneratedModule("export const nested = 11;", {});
        return () => nested["nested"];
      },
    };
    expect(
      evaluateGeneratedModule("export const start = helper();", scope)["start"],
    ).toBe(11);
  });

  it("rejects invalid source before reading helper getters", () => {
    let calls = 0;
    const scope = {
      get helper() {
        calls++;
        throw new Error("getter");
      },
    };
    expect(() =>
      evaluateGeneratedModule("export const start = (;", scope),
    ).toThrow(SyntaxError);
    expect(calls).toBe(0);
  });

  it("preserves a getter exception and global state", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, sourceKey);
    const error = new Error("getter");
    const scope = {
      get helper() {
        expect(Object.getOwnPropertyDescriptor(globalThis, sourceKey)).toEqual(
          previous,
        );
        throw error;
      },
    };
    let thrown: unknown;
    try {
      evaluateGeneratedModule("export const start = helper();", scope);
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBe(error);
    expect(Object.getOwnPropertyDescriptor(globalThis, sourceKey)).toEqual(
      previous,
    );
  });

  it("allows reentrant compilation during generated initialization", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, sourceKey);
    const helper = () => {
      expect(Object.getOwnPropertyDescriptor(globalThis, sourceKey)).toEqual(
        previous,
      );
      return evaluateGeneratedModule("export const nested = 11;", {})["nested"];
    };
    expect(
      evaluateGeneratedModule("export const start = helper();", { helper })[
        "start"
      ],
    ).toBe(11);
    expect(Object.getOwnPropertyDescriptor(globalThis, sourceKey)).toEqual(
      previous,
    );
  });

  it("keeps helper names aligned when a getter removes another key", () => {
    const scope: Record<string, unknown> = {
      get first() {
        delete scope["second"];
        return 1;
      },
      second: 2,
      third: 3,
    };
    expect(
      evaluateGeneratedModule(
        "export const start = [first, second, third];",
        scope,
      )["start"],
    ).toEqual([1, undefined, 3]);
  });

  it("does not read symbol-named helpers that cannot be lexical bindings", () => {
    const unused = Symbol("unused");
    let calls = 0;
    const scope = {
      helper: 7,
      get [unused]() {
        calls++;
        throw new Error("symbol getter");
      },
    };
    expect(
      evaluateGeneratedModule("export const start = helper;", scope)["start"],
    ).toBe(7);
    expect(calls).toBe(0);
  });

  it("does not inherit a deleted helper from its prototype", () => {
    const scope: Record<string, unknown> = Object.create({ second: 9 });
    Object.defineProperties(scope, {
      first: {
        enumerable: true,
        get() {
          delete scope["second"];
          return 1;
        },
      },
      second: { enumerable: true, configurable: true, value: 2 },
      third: { enumerable: true, value: 3 },
    });
    expect(
      evaluateGeneratedModule(
        "export const start = [first, second, third];",
        scope,
      )["start"],
    ).toEqual([1, undefined, 3]);
  });
});

describe("generated helper imports and parser exports", () => {
  it("captures new helper values on repeated construction with the same keys", () => {
    let reads = 0;
    const scope = {
      get helper() {
        return ++reads;
      },
    };
    expect(
      evaluateGeneratedModule("export const start = helper;", scope)["start"],
    ).toBe(1);
    expect(
      evaluateGeneratedModule("export const start = helper;", scope)["start"],
    ).toBe(2);
    expect(reads).toBe(2);
  });

  it("handles different key layouts between repeated global-name bindings", () => {
    expect(
      evaluateGeneratedModule("export const start = Symbol;", { Symbol: 1 })[
        "start"
      ],
    ).toBe(1);
    expect(
      evaluateGeneratedModule("export const start = helper;", { helper: 2 })[
        "start"
      ],
    ).toBe(2);
    expect(
      evaluateGeneratedModule("export const start = Symbol;", {
        "\\u0053ymbol": 3,
      })["start"],
    ).toBe(3);
    expect(
      evaluateGeneratedModule("export const start = Symbol;", { Symbol: 4 })[
        "start"
      ],
    ).toBe(4);
  });

  it("can bind helpers named globalThis, Symbol, and __proto__", () => {
    const scope = {
      globalThis: "custom global",
      Symbol: "custom symbol",
      ["__proto__"]: "custom prototype",
    };
    expect(
      evaluateGeneratedModule(
        "export const start = [globalThis, Symbol, __proto__];",
        scope,
      )["start"],
    ).toEqual(["custom global", "custom symbol", "custom prototype"]);
  });

  it("keeps referenced helper objects mutable", () => {
    const helper = { value: 1 };
    const module = evaluateGeneratedModule(
      "helper.value += 1; export const start = helper;",
      { helper },
    );
    expect(module["start"]).toBe(helper);
    expect(helper.value).toBe(2);
  });

  it("captures an escaped helper identifier under its original key", () => {
    const scope = { "\\u0068elper": 7 };
    expect(
      evaluateGeneratedModule("export const start = helper;", scope)["start"],
    ).toBe(7);
  });

  it("avoids the TDZ of escaped global helper identifiers", () => {
    const scope = { "\\u0067lobalThis": 1, "\\u0053ymbol": 2 };
    expect(
      evaluateGeneratedModule(
        "export const start = [globalThis, Symbol];",
        scope,
      )["start"],
    ).toEqual([1, 2]);
  });

  it.each(["core", "combinator"])(
    "preserves import-like text with a generated %s import",
    (packageName) => {
      const helper = () => 7;
      const text =
        'raw\nimport { missing } from "@suzumiyaaoba/tpeg-core";\nexport const fake = "text";';
      const module = evaluateGeneratedModule(
        `import { helper } from "@suzumiyaaoba/tpeg-${packageName}";\nexport const start = helper;\nexport const text = \`${text}\`;`,
        { helper },
      );
      expect(module["start"]).toBe(helper);
      expect(module["text"]).toBe(text);
      expect(Object.hasOwn(module, "fake")).toBe(false);
    },
  );

  it("rejects a missing imported helper instead of reading its prototype", () => {
    expect(() =>
      evaluateGeneratedModule(
        'import { toString } from "@suzumiyaaoba/tpeg-core"; export const start = toString;',
        {},
      ),
    ).toThrow(/Missing generated import binding "toString"/);
  });

  it("rejects packages outside the generated helper imports", () => {
    expect(() =>
      evaluateGeneratedModule(
        'import { helper } from "other-package"; export const start = helper;',
        { helper: () => 7 },
      ),
    ).toThrow(/Unsupported generated import/);
  });

  it("rejects an unsupported imported alias", () => {
    expect(() =>
      evaluateGeneratedModule(
        'import { helper as aliased } from "@suzumiyaaoba/tpeg-core"; export const start = aliased;',
        { helper: () => 7 },
      ),
    ).toThrow(/Missing generated import binding/);
  });

  it.each(["parse", "constructor", "toString", "__proto__"])(
    "rejects a missing parser export named %s",
    (name) => {
      expect(() =>
        evaluateGeneratedModule(
          "export const other = () => 7;",
          { parse: () => 7 },
          [name],
        ),
      ).toThrow(`Generated module did not produce parser rule "${name}"`);
    },
  );

  it("rejects a non-function parser export", () => {
    expect(() =>
      evaluateGeneratedModule("export const start = 7;", {}, ["start"]),
    ).toThrow(/did not produce parser rule "start"/);
  });

  it("keeps a prototype-named parser export as an own property", () => {
    const module = evaluateGeneratedModule(
      "export const __proto__ = () => 7;",
      {},
      ["__proto__"],
    );
    expect(Object.getPrototypeOf(module)).toBe(null);
    expect(Object.hasOwn(module, "__proto__")).toBe(true);
    expect(typeof Reflect.get(module, "__proto__")).toBe("function");
  });
});

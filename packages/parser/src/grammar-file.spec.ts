import { describe, expect, it } from "vite-plus/test";
import { parseGrammarFile, toGrammarDefinition } from "./grammar-file";

describe("parseGrammarFile", () => {
  it("loads imports, metadata and trailing transforms from a BOM-prefixed file", () => {
    const result = parseGrammarFile(
      "main.tpeg",
      [
        '\uFEFFimport "other.tpeg" as other',
        'grammar Main { @version: "1.0.0"\n start = other.word }',
        "transforms T@typescript { start(x: string) -> Result<string> { return { success: true, value: x }; } }",
        "/* trailing */ // comment at EOF",
      ].join("\r\n"),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const file = result.val;
    expect(file.filePath).toBe("main.tpeg");
    expect(file.imports[0]?.alias).toBe("other");
    expect(file.moduleInfo?.version).toBe("1.0.0");
    const grammar = toGrammarDefinition(file.grammars[0]);
    expect(grammar.type).toBe("GrammarDefinition");
    expect(grammar.transforms?.[0]?.transformSet.name).toBe("T");
  });

  it.each(["unexpected", "/* unfinished", "/*/"])(
    "reports the first unconsumed token %j after complete comments",
    (tail) => {
      const prefix = 'grammar G { r = "x" } /* ok */\r\n  ';
      expect(
        parseGrammarFile("g.tpeg", "\uFEFF" + prefix + tail),
      ).toMatchObject({
        success: false,
        kind: "trailing",
        line: 2,
        column: 3,
        error: { pos: prefix.length },
      });
    },
  );

  it("identifies the missing terminator of a trailing block comment", () => {
    const text = 'grammar G { r = "x" }\n/*';
    expect(parseGrammarFile("g.tpeg", text)).toMatchObject({
      success: false,
      kind: "trailing",
      line: 2,
      column: 1,
      error: { expected: "*/", message: "Unterminated block comment" },
    });
  });

  it("distinguishes syntax errors from trailing content", () => {
    expect(parseGrammarFile("g.tpeg", "\uFEFF?")).toMatchObject({
      success: false,
      kind: "syntax",
      line: 1,
      column: 1,
      error: { pos: 0 },
    });
  });
});

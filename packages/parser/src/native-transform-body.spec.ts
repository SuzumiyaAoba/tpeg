import { expect, test } from "vite-plus/test";
import { transformDefinition } from "./transforms";
import { nativeTransformBodies } from "./native-transform-body";

const cases = [
  {
    language: "python",
    body: '\n    # A } in a comment is not the end of the body.\n    text = r"""a } "quoted" {"""\n    return {"success": True, "value": f"{ {\'key\': \'}\'}[\'key\'] }"}\n',
  },
  {
    language: "go",
    body: '\n    _ = `a } ${`\n    return TransformResult{Success: true, Value: "ok"}\n',
  },
  {
    language: "rust",
    body: '\n    /* outer { /* nested } */ still } */\n    fn borrow<\'a>(value: &\'a str) -> &\'a str { value }\n    let _ = r##"a } "quoted" {"##;\n    let _ = \'}\';\n    Ok(Value::String(borrow("ok").to_owned()))\n',
  },
  {
    language: "typescript",
    body: "\n    const pattern = /}/;\n    class Box { #value = function() { return {}; }; }\n    return { success: true, value: pattern };\n",
  },
];

test.each(cases)(
  "preserves $language body text and finds its actual closing brace",
  ({ language, body }) => {
    const source = `transforms T@${language} { f(captures: any) -> Result<any> {${body}} }`;
    const result = transformDefinition(source, 0);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (result.success) {
      expect(result.next).toBe(source.length);
      expect(result.val.transformSet.functions[0]?.body).toBe(body);
    }
  },
);

test.each(["python", "go", "rust"])(
  "rejects an unterminated %s body",
  (language) => {
    const source = `transforms T@${language} { f(captures: any) -> Result<any> { "unterminated } }`;
    expect(transformDefinition(source, 0).success).toBe(false);
  },
);

test("deep Python replacement strings abort cleanly instead of exhausting the call stack", () => {
  let value = "x";
  for (let index = 0; index < 150; index++) value = `f"{${value}}"`;
  const result = nativeTransformBodies.python(`{ value = ${value} }`, 0);
  expect(result).toMatchObject({
    success: false,
    error: { fatal: true, abort: true },
  });
});

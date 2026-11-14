import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const cli = fileURLToPath(new URL("cli.ts", import.meta.url));
const commands = {
  python: process.env["TPEG_PYTHON"] ?? "python3",
  go: process.env["TPEG_GO"] ?? "go",
  rust: process.env["TPEG_RUSTC"] ?? "rustc",
};

for (const language of ["javascript", "python", "go", "rust"] as const) {
  const available =
    language === "javascript" ||
    !spawnSync(commands[language], ["--version"]).error;
  test.skipIf(!available && process.env["TPEG_NATIVE_REQUIRED"] !== "1")(
    `Bun CLI emits an executable ${language} parser with linked imports and transforms`,
    () => {
      // JS output imports the workspace runtime, just like a consumer's project.
      const directory = mkdtempSync(join(dirname(cli), "../.tmp-e2e-native-"));
      try {
        writeFileSync(
          join(directory, "dep.tpeg"),
          'grammar Dep { number = [0-9]+ }\ntransforms T@typescript { number(captures: any) -> Result<number> { return { success: true, value: (captures as string[]).length }; } }\ntransforms T@python { number(captures: any) -> Result<number> {\n    # A } in a comment is not a TPEG delimiter.\n    return {"success": True, "value": len(captures)}\n} }\ntransforms T@go { number(captures: any) -> Result<number> {\n    _ = `a } ${`\n    return TransformResult{Success: true, Value: len(captures.([]any))}\n} }\ntransforms T@rust { number(captures: any) -> Result<number> {\n    /* outer { /* nested } */ still } */\n    fn borrow<\'a>(value: &\'a str) -> &\'a str { value }\n    let _ = r##"a } "quoted" {"##;\n    let _ = borrow("x");\n    match captures { Value::Array(values) => Ok(Value::Number(values.len() as f64)), _ => Err("expected digits".into()) }\n} }',
        );
        const input = join(directory, "main.tpeg");
        writeFileSync(
          input,
          'import "dep.tpeg" as d\ngrammar Main { start = count:d.number !. }',
        );
        const extension = {
          javascript: "mjs",
          python: "py",
          go: "go",
          rust: "rs",
        }[language];
        const output = join(directory, `parser.${extension}`);
        const args = [cli, input, "--language", language, "--output", output];
        if (language === "javascript") args.push("--bundle");
        if (language === "go") {
          const header = join(directory, "header.txt");
          writeFileSync(header, 'import "fmt"');
          args.push("--package-name", "main", "--header", header);
        }
        execFileSync("bun", args, {
          cwd: directory,
          encoding: "utf8",
          timeout: 30000,
        });
        let text: string;
        if (language === "javascript") {
          text = execFileSync(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              'import { start } from "./parser.mjs"; console.log(JSON.stringify(start("123", 0)));',
            ],
            { cwd: directory, encoding: "utf8", timeout: 30000 },
          );
        } else if (language === "python") {
          text = execFileSync(
            commands.python,
            [
              "-c",
              'import json, parser; print(json.dumps(parser.parse("123")))',
            ],
            { cwd: directory, encoding: "utf8", timeout: 30000 },
          );
        } else if (language === "go") {
          appendFileSync(
            output,
            '\nfunc main() { data, err := json.Marshal(Parse("123")); if err != nil { panic(err) }; fmt.Println(string(data)) }',
          );
          text = execFileSync(commands.go, ["run", output], {
            cwd: directory,
            encoding: "utf8",
            timeout: 120000,
            env: {
              ...process.env,
              GOCACHE:
                process.env["TPEG_GO_CACHE"] ??
                join(tmpdir(), "tpeg-go-build-cache"),
              GOPATH: join(directory, "go-path"),
              GOENV: "off",
              GOTOOLCHAIN: "local",
              GOWORK: "off",
              CGO_ENABLED: "0",
            },
          });
        } else {
          appendFileSync(
            output,
            '\nfn main() { println!("{}", parse("123").to_json()); }',
          );
          const program = join(directory, "program");
          execFileSync(
            commands.rust,
            ["--edition=2021", output, "-o", program],
            { cwd: directory, encoding: "utf8", timeout: 120000 },
          );
          text = execFileSync(program, [], {
            cwd: directory,
            encoding: "utf8",
            timeout: 30000,
          });
        }
        expect(JSON.parse(text)).toEqual({
          success: true,
          val: { count: 3 },
          current: 0,
          next: 3,
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    180000,
  );
}

test.each(["typescript", "javascript"])(
  "CLI %s headers supply external parser bindings",
  (language) => {
    const directory = mkdtempSync(join(dirname(cli), "../.tmp-e2e-header-"));
    try {
      const input = join(directory, "main.tpeg");
      const header = join(directory, "header.txt");
      const output = join(
        directory,
        language === "typescript" ? "parser.ts" : "parser.mjs",
      );
      writeFileSync(input, "grammar G { start = external.word }");
      writeFileSync(
        header,
        'import { literal } from "@suzumiyaaoba/tpeg-core";\nconst external = { word: literal("x") } as const;',
      );
      execFileSync(
        "bun",
        [
          cli,
          input,
          "--language",
          language,
          "--header",
          header,
          "--output",
          output,
        ],
        { cwd: directory, encoding: "utf8", timeout: 30000 },
      );
      const runner = `import { start } from ${JSON.stringify(output)}; console.log(JSON.stringify(start("x", 0)));`;
      const result =
        language === "typescript"
          ? execFileSync("bun", ["-e", runner], {
              cwd: directory,
              encoding: "utf8",
              timeout: 30000,
            })
          : execFileSync(
              process.execPath,
              ["--input-type=module", "-e", runner],
              { cwd: directory, encoding: "utf8", timeout: 30000 },
            );
      expect(JSON.parse(result)).toEqual({
        success: true,
        val: "x",
        current: 0,
        next: 1,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  60000,
);

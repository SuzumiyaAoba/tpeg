import { defineConfig } from "vite-plus";

const generatedIgnores = [
  "**/*.generated.ts",
  "**/*.generated.js",
  "**/*.generated.mjs",
  "packages/parser-sample/.generated/**",
  "packages/cli/.tmp-e2e-*/**",
];

export default defineConfig({
  fmt: {
    useTabs: false,
    tabWidth: 2,
    printWidth: 80,
    singleQuote: false,
    jsxSingleQuote: false,
    quoteProps: "as-needed",
    trailingComma: "all",
    semi: true,
    arrowParens: "always",
    bracketSameLine: false,
    bracketSpacing: true,
    ignorePatterns: generatedIgnores,
  },
  lint: {
    ignorePatterns: generatedIgnores,
    options: {
      typeAware: true,
      typeCheck: false,
    },
    rules: {
      "typescript/no-explicit-any": "warn",
      "eslint/no-unused-vars": [
        "error",
        {
          caughtErrorsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  test: {
    pool: "forks",
    execArgv: ["--stack-size=8000"],
    setupFiles: ["./test/reset-failure-watermark.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "packages/combinator/benchmark.spec.ts",
    ],
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});

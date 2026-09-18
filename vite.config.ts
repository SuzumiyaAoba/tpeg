import { defineConfig } from "vite-plus";

const generatedIgnores = [
  "**/*.generated.ts",
  "**/*.generated.js",
  "**/*.generated.mjs",
  "packages/parser-sample/.generated/**",
  "packages/cli/.tmp-e2e-*/**",
];

export default defineConfig({
  staged: {
    "*.{ts,js,mjs,cjs,json}": "vp check --fix",
  },
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
    // PBT/fuzz specs multiply their workload by TPEG_FUZZ_SCALE (see the
    // FUZZ_SCALE comments in *pbt*.spec.ts and *laws*.spec.ts, e.g.
    // `TPEG_FUZZ_SCALE=30 bun test src/pbt-invariants.spec.ts`). Without a
    // matching timeout budget every scaled test hits Vitest's 5s default
    // and fails with "timed out" -- which is what happened to most scaled
    // specs, while the few that set `10000 * FUZZ_SCALE`-style per-test
    // timeouts kept working. Scale the default the same way; tests that
    // pass an explicit timeout keep their own budget.
    testTimeout:
      5000 * Math.max(1, Number(process.env["TPEG_FUZZ_SCALE"]) || 1),
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

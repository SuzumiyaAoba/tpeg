import { defineConfig } from "vite-plus";

export default defineConfig({
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

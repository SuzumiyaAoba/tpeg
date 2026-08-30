import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // Keep the demos as separate distributable entry points. The public
    // `run*Demo` helpers in dist/index.js launch these files after the
    // package has been packed, so they must not remain source-only paths.
    entry: [
      "src/index.ts",
      "src/basic-demo.ts",
      "src/grammar-demo.ts",
      "src/file-demo.ts",
      "src/demo.ts",
    ],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    platform: "node",
    fixedExtension: false,
  },
});

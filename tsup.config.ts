import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  outExtension() { return { js: ".js" } },
  clean: true,
  banner: { js: "#!/usr/bin/env node\n" },
  splitting: false,
  sourcemap: false,
  minify: false,
  external: ["bun:sqlite"],
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them; keep npm deps external.
  noExternal: [/^@bldt\//],
  // Bundled CommonJS dependencies (pg, ioredis) call require(); give the ESM bundle one.
  banner: { js: 'import { createRequire as __bldtRequire } from "node:module"; const require = __bldtRequire(import.meta.url);' },
});

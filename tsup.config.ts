import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "adapters/drizzle/pg": "src/adapters/drizzle/pg.ts",
    "adapters/drizzle/sqlite": "src/adapters/drizzle/sqlite.ts",
    "adapters/redis": "src/adapters/redis/index.ts",
  },
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
});

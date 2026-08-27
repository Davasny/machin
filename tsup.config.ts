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
  // TODO: remove once tsup stops injecting baseUrl into the dts build (egoist/tsup#1388, egoist/tsup#1405)
  dts: {
    compilerOptions: {
      ignoreDeprecations: "6.0",
    },
  },
  sourcemap: true,
  clean: true,
});

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  dbCredentials: {
    url: "postgresql://machin:machin_password@localhost:5432/machin",
  },
});

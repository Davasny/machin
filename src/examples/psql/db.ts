import { drizzle } from "drizzle-orm/node-postgres";

export const db: ReturnType<typeof drizzle> = drizzle({
  connection: "postgresql://machin:machin_password@localhost:5432/machin",
});

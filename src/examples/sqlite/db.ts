import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

/**
 * SQLite Database Setup
 *
 * Using better-sqlite3 for synchronous SQLite operations.
 * This example uses an in-memory database for demonstration.
 *
 * For production, replace ":memory:" with a file path:
 *   new Database("./data/orders.db")
 */
const sqlite = new Database(":memory:");

// Create the orders table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
   id TEXT PRIMARY KEY,
   state TEXT NOT NULL,
   created_at INTEGER NOT NULL,
   updated_at INTEGER NOT NULL,
   stripe_customer_id TEXT
  )
`);

export const db = drizzle(sqlite, { schema });

/**
 * Close the database connection
 * Call this when shutting down the application
 */
export function closeDb() {
  sqlite.close();
}

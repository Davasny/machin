import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";

/**
 * SQLite Schema for Subscriptions
 *
 * Key SQLite conventions:
 * - text() for IDs (no native UUID type)
 * - integer({ mode: "timestamp" }) for dates - Drizzle converts Date <-> unix timestamp
 * - snake_case column names
 */
export const subscriptionsTable = sqliteTable("subscriptions", {
  // System fields (required by transito)
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  state: text("state").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),

  // Context fields
  stripeCustomerId: text("stripe_customer_id"),
});

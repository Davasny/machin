import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";
import { InferStates } from "@/index.js";
import { subscribeMachineConfig } from "../subscribe-machine-config.js";

/**
 * SQLite Schema for Subscriptions
 *
 * Key SQLite conventions:
 * - text() for IDs (no native UUID type)
 * - integer({ mode: "timestamp" }) for dates - Drizzle converts Date <-> unix timestamp
 * - snake_case column names
 */

/**
 * Use type inference to ensure the state column matches the machine definition.
 * This creates a union type of all possible states:
 * → "inactive" | "activating" | "activation_failed" | "active"
 */
type SubscriptionState = InferStates<typeof subscribeMachineConfig>;

export const subscriptionsTable = sqliteTable("subscriptions", {
  // System fields (required by machin)
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  state: text("state").$type<SubscriptionState>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),

  // Context fields
  stripeCustomerId: text("stripe_customer_id"),
});

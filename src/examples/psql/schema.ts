import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { InferStates } from "@/index.js";
import { subscribeMachineConfig } from "../subscribe-machine-config.js";

/**
 * Use type inference to ensure the state column matches the machine definition.
 * This creates a union type of all possible states:
 * → "inactive" | "activating" | "activation_failed" | "active"
 */
type SubscriptionState = InferStates<typeof subscribeMachineConfig>;

export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  state: text().$type<SubscriptionState>().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),

  stripeCustomerId: text(),
});

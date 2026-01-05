import type { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import type { BoundMachine, MachineDefinition } from "@/types.js";
import {
  BoundMachineImpl,
  DrizzleAdapter,
  type DrizzleAdapterConfig,
  SYSTEM_FIELDS,
  type ValidateContext,
} from "./core.js";

// ============================================================
// SQLite-specific withDrizzleSQLite
// ============================================================

/**
 * Binds a machine definition to a Drizzle SQLite table, creating a BoundMachine
 * that can create, load, and persist actors.
 *
 * @param machineDefinition - The machine definition created by machine()
 * @param config - Drizzle configuration with db instance and table
 * @returns A BoundMachine with createActor and getActor methods
 *
 * @example
 * ```ts
 * import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
 * import { withDrizzleSQLite } from "transito/drizzle/sqlite";
 *
 * const subscriptionsTable = sqliteTable("subscriptions", {
 *   id: text("id").primaryKey(),
 *   state: text("state").notNull(),
 *   createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
 *   updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
 *   stripeCustomerId: text("stripe_customer_id"),
 * });
 *
 * const boundMachine = withDrizzleSQLite(subscriptionMachine, {
 *   db,
 *   table: subscriptionsTable,
 * });
 *
 * const actor = await boundMachine.createActor("sub_123", { stripeCustomerId: null });
 * ```
 */
export function withDrizzleSQLite<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
  // biome-ignore lint/suspicious/noExplicitAny: SQLiteTableWithColumns requires generic parameter
  TTable extends SQLiteTableWithColumns<any>,
>(
  machineDefinition: MachineDefinition<TContext, TStates, TEvents, TStateNodes>,
  config: DrizzleAdapterConfig<TTable> &
    (ValidateContext<TContext, TTable> extends true
      ? unknown
      : { __error: "Context type does not match table columns" }),
): BoundMachine<TContext, TStates, TEvents, TStateNodes> {
  // Extract context keys from table schema (excluding system fields)
  const tableKeys = Object.keys(config.table);
  const contextKeys = tableKeys.filter(
    (k) => !SYSTEM_FIELDS.includes(k as (typeof SYSTEM_FIELDS)[number]),
  );

  const adapter = new DrizzleAdapter<TContext, TStates, TTable>(
    config as DrizzleAdapterConfig<TTable>,
    contextKeys,
  );

  return new BoundMachineImpl(machineDefinition, adapter);
}

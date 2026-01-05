import type { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import type { BoundMachine, MachineDefinition } from "../../types.js";
import {
  type DrizzleAdapterConfig,
  type ValidateContext,
  DrizzleAdapter,
  BoundMachineImpl,
} from "./core.js";

// ============================================================
// SQLite-specific withDrizzle
// ============================================================

/**
 * Binds a machine definition to a Drizzle SQLite table, creating a BoundMachine
 * that can create, load, and persist actors.
 *
 * @param machineDefinition - The machine definition created by machine()
 * @param config - Drizzle configuration with db instance and table
 * @returns A BoundMachine with createActor, getActor, and getOrCreateActor methods
 *
 * @example
 * ```ts
 * import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
 * import { withDrizzle } from "transito/drizzle/sqlite";
 *
 * const subscriptionsTable = sqliteTable("subscriptions", {
 *   id: text("id").primaryKey(),
 *   state: text("state").notNull(),
 *   createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
 *   updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
 *   stripeCustomerId: text("stripe_customer_id"),
 * });
 *
 * const boundMachine = withDrizzle(subscriptionMachine, {
 *   db,
 *   table: subscriptionsTable,
 * });
 *
 * const actor = await boundMachine.createActor("sub_123");
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: SQLiteTableWithColumns requires generic parameter
export function withDrizzle<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
  TTable extends SQLiteTableWithColumns<any>,
>(
  machineDefinition: MachineDefinition<TContext, TStates, TEvents, TStateNodes>,
  config: DrizzleAdapterConfig<TTable> &
    (ValidateContext<TContext, TTable> extends true
      ? unknown
      : { __error: "Context type does not match table columns" }),
): BoundMachine<TContext, TStates, TEvents, TStateNodes> {
  // Extract context keys from the machine's initial context
  const contextKeys = Object.keys(machineDefinition.config.context as object);

  const adapter = new DrizzleAdapter<TContext, TStates, TTable>(
    config as DrizzleAdapterConfig<TTable>,
    contextKeys,
  );

  return new BoundMachineImpl(machineDefinition, adapter);
}

import type { PgTable, TableConfig } from "drizzle-orm/pg-core";
import type { BoundMachine, MachineDefinition } from "../../types.js";
import {
  type DrizzleAdapterConfig,
  type ValidateContext,
  DrizzleAdapter,
  BoundMachineImpl,
} from "./core.js";

// ============================================================
// PostgreSQL-specific withDrizzle
// ============================================================

/**
 * Binds a machine definition to a Drizzle PostgreSQL table, creating a BoundMachine
 * that can create, load, and persist actors.
 *
 * @param machineDefinition - The machine definition created by machine()
 * @param config - Drizzle configuration with db instance and table
 * @returns A BoundMachine with createActor, getActor, and getOrCreateActor methods
 *
 * @example
 * ```ts
 * import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
 * import { withDrizzle } from "transito/drizzle/pg";
 *
 * const subscriptionsTable = pgTable("subscriptions", {
 *   id: uuid().primaryKey(),
 *   state: text().notNull(),
 *   createdAt: timestamp().notNull(),
 *   updatedAt: timestamp().notNull(),
 *   stripeCustomerId: text(),
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
export function withDrizzle<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
  TTable extends PgTable<TableConfig>,
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

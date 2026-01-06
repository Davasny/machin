import type { PgTable } from "drizzle-orm/pg-core";
import type { BoundMachine, MachineDefinition } from "@/types";
import {
  BoundMachineImpl,
  DrizzleAdapter,
  type DrizzleAdapterConfig,
  SYSTEM_FIELDS,
  type ValidateContext,
} from "./core";

// ============================================================
// PostgreSQL-specific withDrizzlePg
// ============================================================

/**
 * Binds a machine definition to a Drizzle PostgreSQL table, creating a BoundMachine
 * that can create, load, and persist actors.
 *
 * @param machineDefinition - The machine definition created by machine()
 * @param config - Drizzle configuration with db instance and table
 * @returns A BoundMachine with createActor and getActor methods
 *
 * @example
 * ```ts
 * import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
 * import { withDrizzlePg } from "machin/drizzle/pg";
 *
 * const subscriptionsTable = pgTable("subscriptions", {
 *   id: uuid().primaryKey(),
 *   state: text().notNull(),
 *   createdAt: timestamp().notNull(),
 *   updatedAt: timestamp().notNull(),
 *   stripeCustomerId: text(),
 * });
 *
 * const boundMachine = withDrizzlePg(subscriptionMachine, {
 *   db,
 *   table: subscriptionsTable,
 * });
 *
 * const actor = await boundMachine.createActor("sub_123", { stripeCustomerId: null });
 * ```
 */
export function withDrizzlePg<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
  TTable extends PgTable,
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

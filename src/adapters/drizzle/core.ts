import { eq } from "drizzle-orm";
import { createActorFromSnapshot } from "../../actor.js";
import { ActorAlreadyExistsError } from "../../errors.js";
import type {
  Actor,
  Adapter,
  BoundMachine,
  MachineDefinition,
  Snapshot,
} from "../../types.js";

// ============================================================
// Type Utilities for Drizzle
// ============================================================

/**
 * System fields that are required in the table but not part of context
 */
type SystemFields = "id" | "state" | "createdAt" | "updatedAt";

/**
 * Minimal table interface that works across all Drizzle dialects
 */
export interface DrizzleTable {
  $inferSelect: Record<string, unknown>;
}

/**
 * Extract the select type from a Drizzle table
 */
export type TableSelect<TTable> = TTable extends { $inferSelect: infer R }
  ? R
  : never;

/**
 * Extract context type from Drizzle table (excluding system fields)
 */
export type ContextFromTable<TTable> = Omit<TableSelect<TTable>, SystemFields>;

/**
 * Validate that Context matches the table's context fields
 */
export type ValidateContext<TContext, TTable> =
  TContext extends ContextFromTable<TTable>
    ? ContextFromTable<TTable> extends TContext
      ? true
      : false
    : false;

// ============================================================
// Types for database abstraction
// ============================================================

/**
 * Minimal database interface needed by the adapter
 * This allows for easier mocking and testing
 */
export interface DrizzleDatabase {
  select(): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(n: number): Promise<unknown[]>;
      };
    };
  };
  insert(table: unknown): {
    values(data: unknown): Promise<unknown>;
  };
  update(table: unknown): {
    set(data: unknown): {
      where(condition: unknown): Promise<unknown>;
    };
  };
}

// ============================================================
// Drizzle Adapter Implementation
// ============================================================

/**
 * Configuration for Drizzle adapter
 */
export interface DrizzleAdapterConfig<TTable extends DrizzleTable> {
  db: DrizzleDatabase;
  table: TTable;
}

/**
 * Creates a Drizzle adapter that implements the Adapter interface
 */
export class DrizzleAdapter<
  TContext,
  TStates extends string,
  TTable extends DrizzleTable,
> implements Adapter<TContext, TStates>
{
  private readonly db: DrizzleDatabase;
  private readonly table: TTable;
  private readonly contextKeys: string[];

  constructor(config: DrizzleAdapterConfig<TTable>, contextKeys: string[]) {
    this.db = config.db;
    this.table = config.table;
    this.contextKeys = contextKeys;
  }

  async load(id: string): Promise<Snapshot<TContext, TStates> | null> {
    const tableAny = this.table as Record<string, unknown>;
    const idColumn = tableAny["id"] as Parameters<typeof eq>[0];

    const results = await this.db
      .select()
      .from(this.table)
      .where(eq(idColumn, id))
      .limit(1);

    const row = results[0];
    if (!row) {
      return null;
    }

    const rowRecord = row as Record<string, unknown>;
    const context = {} as Record<string, unknown>;
    for (const key of this.contextKeys) {
      context[key] = rowRecord[key];
    }

    return {
      id: rowRecord["id"] as string,
      state: rowRecord["state"] as TStates,
      context: context as TContext,
      createdAt: rowRecord["createdAt"] as Date,
      updatedAt: rowRecord["updatedAt"] as Date,
    };
  }

  async create(
    id: string,
    state: TStates,
    context: TContext,
  ): Promise<Snapshot<TContext, TStates>> {
    const now = new Date();
    const contextRecord = context as Record<string, unknown>;

    const insertData = {
      id,
      state,
      createdAt: now,
      updatedAt: now,
      ...contextRecord,
    };

    await this.db.insert(this.table).values(insertData);

    return {
      id,
      state,
      context,
      createdAt: now,
      updatedAt: now,
    };
  }

  async save(snapshot: Snapshot<TContext, TStates>): Promise<void> {
    const tableAny = this.table as Record<string, unknown>;
    const idColumn = tableAny["id"] as Parameters<typeof eq>[0];
    const contextRecord = snapshot.context as Record<string, unknown>;

    const updateData = {
      state: snapshot.state,
      updatedAt: snapshot.updatedAt,
      ...contextRecord,
    };

    await this.db
      .update(this.table)
      .set(updateData)
      .where(eq(idColumn, snapshot.id));
  }
}

// ============================================================
// Bound Machine Implementation
// ============================================================

export class BoundMachineImpl<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
  TTable extends DrizzleTable,
> implements BoundMachine<TContext, TStates, TEvents, TStateNodes>
{
  private readonly machineDefinition: MachineDefinition<
    TContext,
    TStates,
    TEvents,
    TStateNodes
  >;
  private readonly adapter: DrizzleAdapter<TContext, TStates, TTable>;

  constructor(
    machineDefinition: MachineDefinition<
      TContext,
      TStates,
      TEvents,
      TStateNodes
    >,
    adapter: DrizzleAdapter<TContext, TStates, TTable>,
  ) {
    this.machineDefinition = machineDefinition;
    this.adapter = adapter;
  }

  async createActor(
    id: string,
  ): Promise<Actor<TContext, TStates, TEvents, TStateNodes>> {
    // Check if actor already exists
    const existing = await this.adapter.load(id);
    if (existing) {
      throw new ActorAlreadyExistsError(id);
    }

    const snapshot = await this.adapter.create(
      id,
      this.machineDefinition.config.initial,
      this.machineDefinition.config.context,
    );

    return createActorFromSnapshot(
      snapshot,
      this.machineDefinition,
      this.adapter,
    );
  }

  async getActor(
    id: string,
  ): Promise<Actor<TContext, TStates, TEvents, TStateNodes> | null> {
    const snapshot = await this.adapter.load(id);
    if (!snapshot) {
      return null;
    }

    return createActorFromSnapshot(
      snapshot,
      this.machineDefinition,
      this.adapter,
    );
  }

  async getOrCreateActor(
    id: string,
  ): Promise<Actor<TContext, TStates, TEvents, TStateNodes>> {
    const existing = await this.adapter.load(id);
    if (existing) {
      return createActorFromSnapshot(
        existing,
        this.machineDefinition,
        this.adapter,
      );
    }

    const snapshot = await this.adapter.create(
      id,
      this.machineDefinition.config.initial,
      this.machineDefinition.config.context,
    );

    return createActorFromSnapshot(
      snapshot,
      this.machineDefinition,
      this.adapter,
    );
  }
}

// ============================================================
// Factory function for creating withDrizzle
// ============================================================

/**
 * Creates a withDrizzle function for a specific table type
 * Used by dialect-specific modules (pg.ts, sqlite.ts)
 */
export function createWithDrizzle<TTableConstraint extends DrizzleTable>() {
  return function withDrizzle<
    TContext,
    TStates extends string,
    TEvents extends string,
    TStateNodes,
    TTable extends TTableConstraint,
  >(
    machineDefinition: MachineDefinition<
      TContext,
      TStates,
      TEvents,
      TStateNodes
    >,
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
  };
}

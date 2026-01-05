import { createActorFromSnapshot } from "@/actor.js";
import { ActorAlreadyExistsError } from "@/errors.js";
import type {
  Actor,
  Adapter,
  BoundMachine,
  MachineDefinition,
  Snapshot,
} from "@/types.js";

// ============================================================
// Redis Client Interface
// ============================================================

/**
 * Minimal Redis client interface for testability and flexibility.
 * Compatible with the official `redis` package v4+.
 */
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

// ============================================================
// Redis Adapter Configuration
// ============================================================

/**
 * Configuration for the Redis adapter.
 */
export interface RedisAdapterConfig {
  client: RedisClientLike;
}

// ============================================================
// Serialized Snapshot Type
// ============================================================

/**
 * Snapshot as stored in Redis (Dates serialized as ISO strings)
 */
interface SerializedSnapshot<TContext, TStates extends string> {
  id: string;
  state: TStates;
  context: TContext;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Redis Adapter Implementation
// ============================================================

/**
 * Redis adapter that implements the Adapter interface.
 * Stores snapshots as JSON strings in Redis.
 */
export class RedisAdapter<TContext, TStates extends string>
  implements Adapter<TContext, TStates>
{
  private readonly client: RedisClientLike;

  constructor(config: RedisAdapterConfig) {
    this.client = config.client;
  }

  async load(id: string): Promise<Snapshot<TContext, TStates> | null> {
    const json = await this.client.get(id);
    if (!json) {
      return null;
    }

    const data = JSON.parse(json) as SerializedSnapshot<TContext, TStates>;

    return {
      id: data.id,
      state: data.state,
      context: data.context,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  async create(
    id: string,
    state: TStates,
    context: TContext,
  ): Promise<Snapshot<TContext, TStates>> {
    const now = new Date();

    const snapshot: Snapshot<TContext, TStates> = {
      id,
      state,
      context,
      createdAt: now,
      updatedAt: now,
    };

    await this.client.set(id, JSON.stringify(snapshot));

    return snapshot;
  }

  async save(snapshot: Snapshot<TContext, TStates>): Promise<void> {
    await this.client.set(snapshot.id, JSON.stringify(snapshot));
  }
}

// ============================================================
// Bound Machine Implementation
// ============================================================

class BoundMachineImpl<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
> implements BoundMachine<TContext, TStates, TEvents, TStateNodes>
{
  private readonly machineDefinition: MachineDefinition<
    TContext,
    TStates,
    TEvents,
    TStateNodes
  >;
  private readonly adapter: RedisAdapter<TContext, TStates>;

  constructor(
    machineDefinition: MachineDefinition<
      TContext,
      TStates,
      TEvents,
      TStateNodes
    >,
    adapter: RedisAdapter<TContext, TStates>,
  ) {
    this.machineDefinition = machineDefinition;
    this.adapter = adapter;
  }

  async createActor(
    id: string,
    context: TContext,
  ): Promise<Actor<TContext, TStates, TEvents, TStateNodes>> {
    // Check if actor already exists
    const existing = await this.adapter.load(id);
    if (existing) {
      throw new ActorAlreadyExistsError(id);
    }

    const snapshot = await this.adapter.create(
      id,
      this.machineDefinition.config.initial,
      context,
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
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Binds a machine definition to a Redis client, creating a BoundMachine
 * that can create, load, and persist actors.
 *
 * @param machineDefinition - The machine definition created by machine()
 * @param config - Redis configuration with client instance
 * @returns A BoundMachine with createActor and getActor methods
 *
 * @example
 * ```ts
 * import { createClient } from 'redis';
 * import { withRedis } from 'transito/redis';
 *
 * const redis = await createClient().connect();
 *
 * const boundMachine = withRedis(subscriptionMachine, {
 *   client: redis,
 * });
 *
 * const actor = await boundMachine.createActor('sub_123', { stripeCustomerId: null });
 * // Stored at Redis key "sub_123" as JSON
 * ```
 */
export function withRedis<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
>(
  machineDefinition: MachineDefinition<TContext, TStates, TEvents, TStateNodes>,
  config: RedisAdapterConfig,
): BoundMachine<TContext, TStates, TEvents, TStateNodes> {
  const adapter = new RedisAdapter<TContext, TStates>(config);
  return new BoundMachineImpl(machineDefinition, adapter);
}

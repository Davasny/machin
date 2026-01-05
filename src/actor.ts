import type {
  Actor as ActorInterface,
  Adapter,
  MachineDefinition,
  PayloadForEvent,
  Snapshot,
} from "./types.js";

/**
 * Creates an Actor instance from a snapshot
 */
export function createActorFromSnapshot<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
>(
  snapshot: Snapshot<TContext, TStates>,
  machineDefinition: MachineDefinition<TContext, TStates, TEvents, TStateNodes>,
  adapter: Adapter<TContext, TStates>,
): ActorInterface<TContext, TStates, TEvents, TStateNodes> {
  return new ActorImpl(snapshot, machineDefinition, adapter);
}

class ActorImpl<TContext, TStates extends string, TEvents extends string, TStateNodes>
  implements ActorInterface<TContext, TStates, TEvents, TStateNodes>
{
  readonly id: string;
  readonly state: TStates;
  readonly context: TContext;

  private readonly snapshot: Snapshot<TContext, TStates>;
  private readonly machineDefinition: MachineDefinition<
    TContext,
    TStates,
    TEvents,
    TStateNodes
  >;
  private readonly adapter: Adapter<TContext, TStates>;

  constructor(
    snapshot: Snapshot<TContext, TStates>,
    machineDefinition: MachineDefinition<TContext, TStates, TEvents, TStateNodes>,
    adapter: Adapter<TContext, TStates>,
  ) {
    this.snapshot = snapshot;
    this.machineDefinition = machineDefinition;
    this.adapter = adapter;

    this.id = snapshot.id;
    this.state = snapshot.state;
    this.context = snapshot.context;
  }

  send = async <E extends TEvents>(
    ...args: PayloadForEvent<TStateNodes, E & string> extends undefined
      ? [event: E]
      : [event: E, payload: PayloadForEvent<TStateNodes, E & string>]
  ): Promise<ActorInterface<TContext, TStates, TEvents, TStateNodes>> => {
    const [event, payload] = args as [E, unknown];
    const states = this.machineDefinition.config.states as Record<
      string,
      {
        on?: Record<string, { target: string }>;
        entry?: (ctx: TContext, event: unknown) => TContext | Promise<TContext>;
        onSuccess?: { target: string };
        onError?: { target: string };
      }
    >;
    const currentStateConfig = states[this.state];

    // Check if event is handled in current state
    const transition = currentStateConfig?.on?.[event as string];
    if (!transition) {
      // Unhandled event = no-op, return same actor
      return this;
    }

    const targetStateName = transition.target as TStates;
    const targetStateConfig = states[targetStateName];

    let newContext = this.context;
    let finalState = targetStateName;

    // Execute entry function if defined
    if (targetStateConfig?.entry) {
      try {
        const result = targetStateConfig.entry(this.context, payload);
        newContext = result instanceof Promise ? await result : result;

        // On success, transition to onSuccess target
        if (targetStateConfig.onSuccess) {
          finalState = targetStateConfig.onSuccess.target as TStates;
        }
      } catch (error) {
        // On error, transition to onError target if defined
        if (targetStateConfig.onError) {
          finalState = targetStateConfig.onError.target as TStates;
        } else {
          // No onError defined - re-throw the error
          throw error;
        }
      }
    }

    // Create new snapshot
    const newSnapshot: Snapshot<TContext, TStates> = {
      id: this.id,
      state: finalState,
      context: newContext,
      createdAt: this.snapshot.createdAt,
      updatedAt: new Date(),
    };

    // Persist via adapter
    await this.adapter.save(newSnapshot);

    // Return new Actor instance (immutable)
    return new ActorImpl(newSnapshot, this.machineDefinition, this.adapter);
  };
}

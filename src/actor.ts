import type {
  Actor as ActorInterface,
  Adapter,
  ErrorTransitionDefinition,
  EventTransitionDefinition,
  MachineDefinition,
  PayloadForEvent,
  Snapshot,
  SuccessTransitionDefinition,
  TransitionBranch,
} from "./types.js";

type RuntimeStateConfig<TContext> = {
  on?: Record<string, EventTransitionDefinition<TContext, string, unknown>>;
  entry?: (ctx: TContext, event: unknown) => TContext | Promise<TContext>;
  onSuccess?: SuccessTransitionDefinition<TContext, string>;
  onError?: ErrorTransitionDefinition<TContext, string>;
};

function isPayloadAwareGuard<TContext, TPayload = undefined, TError = never>(
  branch: TransitionBranch<TContext, string, TPayload, TError>,
): boolean {
  return (branch.guard?.length ?? 0) > 1;
}

function normalizeTransition<TContext, TPayload = undefined, TError = never>(
  transition:
    | { target: string }
    | readonly TransitionBranch<TContext, string, TPayload, TError>[]
    | undefined,
): readonly TransitionBranch<TContext, string, TPayload, TError>[] {
  if (!transition) {
    return [];
  }

  return Array.isArray(transition)
    ? transition
    : [transition as TransitionBranch<TContext, string, TPayload, TError>];
}

function resolveTransition<TContext, TPayload = undefined, TError = never>(
  transition:
    | { target: string }
    | readonly TransitionBranch<TContext, string, TPayload, TError>[]
    | undefined,
  ctx: TContext,
  value?: TPayload | TError,
): TransitionBranch<TContext, string, TPayload, TError> | undefined {
  for (const branch of normalizeTransition(transition)) {
    if (!branch.guard) {
      return branch;
    }

    const matches =
      value === undefined
        ? (branch.guard as (ctx: TContext) => boolean)(ctx)
        : (
            branch.guard as (ctx: TContext, value: TPayload | TError) => boolean
          )(ctx, value);

    if (matches) {
      return branch;
    }
  }

  return undefined;
}

function getNextEvents<TContext, TEvents extends string>(
  states: Record<string, RuntimeStateConfig<TContext>>,
  currentState: string,
  context: TContext,
): TEvents[] {
  const currentStateConfig = states[currentState];

  if (!currentStateConfig?.on) {
    return [];
  }

  const nextEvents: TEvents[] = [];

  for (const [event, transition] of Object.entries(currentStateConfig.on)) {
    const branches = normalizeTransition(transition);

    const isAvailable = branches.some((branch) => {
      if (!branch.guard) {
        return true;
      }

      if (isPayloadAwareGuard(branch)) {
        return true;
      }

      return (branch.guard as (ctx: TContext) => boolean)(context);
    });

    if (isAvailable) {
      nextEvents.push(event as TEvents);
    }
  }

  return nextEvents;
}

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

class ActorImpl<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
> implements ActorInterface<TContext, TStates, TEvents, TStateNodes>
{
  readonly id: string;
  readonly state: TStates;
  readonly context: TContext;
  readonly nextEvents: TEvents[];

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
    machineDefinition: MachineDefinition<
      TContext,
      TStates,
      TEvents,
      TStateNodes
    >,
    adapter: Adapter<TContext, TStates>,
  ) {
    this.snapshot = snapshot;
    this.machineDefinition = machineDefinition;
    this.adapter = adapter;

    this.id = snapshot.id;
    this.state = snapshot.state;
    this.context = snapshot.context;
    this.nextEvents = getNextEvents<TContext, TEvents>(
      this.machineDefinition.config.states as Record<
        string,
        RuntimeStateConfig<TContext>
      >,
      this.state,
      this.context,
    );
  }

  send = async <E extends TEvents>(
    ...args: PayloadForEvent<TStateNodes, E & string> extends undefined
      ? [event: E]
      : [event: E, payload: PayloadForEvent<TStateNodes, E & string>]
  ): Promise<ActorInterface<TContext, TStates, TEvents, TStateNodes>> => {
    const [event, payload] = args as [E, unknown];
    const states = this.machineDefinition.config.states as Record<
      string,
      RuntimeStateConfig<TContext>
    >;
    const currentStateConfig = states[this.state];

    // Check if event is handled in current state
    const transition = currentStateConfig?.on?.[event as string];
    const targetTransition = resolveTransition(
      transition,
      this.context,
      payload,
    );
    if (!targetTransition) {
      // Unhandled event = no-op, return same actor
      return this;
    }

    const targetStateName = targetTransition.target;

    const targetStateConfig = states[targetStateName];

    let newContext = this.context;
    let finalState = targetStateName as TStates;
    let errorMessage = this.snapshot.errorMessage;

    // Execute entry function if defined
    if (targetStateConfig?.entry) {
      try {
        const result = targetStateConfig.entry(this.context, payload);
        newContext = result instanceof Promise ? await result : result;
        errorMessage = "";

        // On success, transition to onSuccess target
        if (targetStateConfig.onSuccess) {
          finalState = (resolveTransition(
            targetStateConfig.onSuccess,
            newContext,
          )?.target ?? targetStateName) as TStates;
        }
      } catch (error) {
        const onActorError = this.machineDefinition.config.onActorError;
        if (onActorError) {
          try {
            onActorError({
              id: this.id,
              state: targetStateName as TStates,
              error,
              context: this.context,
            });
          } catch {
            // Observability hooks must not break state transitions.
          }
        }

        // On error, transition to onError target if defined
        if (targetStateConfig.onError) {
          const errorTransition = resolveTransition(
            targetStateConfig.onError,
            this.context,
            error,
          );

          if (errorTransition) {
            errorMessage = getErrorMessage(error);
            finalState = errorTransition.target as TStates;
          } else {
            throw error;
          }
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
      errorMessage,
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

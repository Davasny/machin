// ============================================================
// Type Utilities for Entry Return Validation
// ============================================================

/**
 * Check if T's keys exactly match U's keys.
 * Returns true if both types have identical key sets.
 */
type SameKeys<T, U> = keyof T extends keyof U
  ? keyof U extends keyof T
    ? true
    : false
  : false;

/**
 * Check if T is assignable to U.
 * Special case: never return type (throwing functions) is always valid.
 */
type IsAssignable<T, U> = [T] extends [never]
  ? true
  : [T] extends [U]
    ? true
    : false;

/**
 * Valid entry return: keys must match exactly AND values must be assignable.
 * This allows narrower value types (e.g., string → string | undefined)
 * while catching typos and extra keys.
 * Special case: never return type (throwing functions) is always valid.
 */
type IsValidEntryReturn<TReturn, TContext> = [TReturn] extends [never]
  ? true
  : SameKeys<TReturn, TContext> extends true
    ? IsAssignable<TReturn, TContext>
    : false;

/**
 * Extracts return type from an entry function (unwraps Promise)
 */
type ExtractEntryReturn<TNode> = TNode extends {
  // biome-ignore lint/suspicious/noExplicitAny: Need any to match any entry function signature
  entry: (...args: any[]) => infer R;
}
  ? Awaited<R>
  : never;

/**
 * Finds state names where entry return type doesn't match context.
 * Returns never if all entries are valid, otherwise returns the invalid state name.
 * Validates that return type has same keys as context and values are assignable.
 */
type HasInvalidEntry<TContext, TStates> = {
  // biome-ignore lint/suspicious/noExplicitAny: Need any to match any entry function signature
  [K in keyof TStates]: TStates[K] extends { entry: (...args: any[]) => any }
    ? IsValidEntryReturn<ExtractEntryReturn<TStates[K]>, TContext> extends true
      ? never
      : K
    : never;
}[keyof TStates];

/**
 * Validates machine config - adds __error property if any entry returns wrong type.
 * This forces TypeScript to error when the config is passed to machine().
 *
 * Validation rules:
 * - Entry return type must have exactly the same keys as TContext (no extra, no missing)
 * - Entry return values must be assignable to TContext values (allows narrower types)
 * - Throwing functions (never return type) are always valid
 *
 * Examples:
 * - `{ stripeCustomerId: string }` → `{ stripeCustomerId: string | undefined }` ✅ (narrower value)
 * - `{ stripeCustomerld: string }` → `{ stripeCustomerId: string }` ❌ (typo in key)
 * - `{ stripeCustomerId: string, extra: number }` → `{ stripeCustomerId: string }` ❌ (extra key)
 */
export type ValidatedMachineConfig<
  TContext,
  TStates,
  TInitial extends string,
> = HasInvalidEntry<TContext, TStates> extends never
  ? { initial: TInitial; states: TStates }
  : {
      initial: TInitial;
      states: TStates;
      __error: `Entry in state '${HasInvalidEntry<TContext, TStates> & string}' must return exactly the context type`;
    };

// ============================================================
// State Node Types
// ============================================================

/**
 * Transition target definition
 */
export interface TransitionTarget<TStates extends string> {
  target: TStates;
}

/**
 * State node without entry (simple state)
 */
export interface SimpleStateNode<TStates extends string> {
  on?: Record<string, TransitionTarget<TStates>>;
  entry?: undefined;
  onSuccess?: undefined;
  onError?: undefined;
}

/**
 * State node with entry (must have onSuccess, optionally onError)
 */
export interface EntryStateNode<TContext, TStates extends string, TPayload> {
  on?: Record<string, TransitionTarget<TStates>>;
  entry: (ctx: TContext, event: TPayload) => TContext | Promise<TContext>;
  onSuccess: TransitionTarget<TStates>;
  onError?: TransitionTarget<TStates>;
}

/**
 * Union of all state node types
 */
export type StateNode<TContext, TStates extends string> =
  | SimpleStateNode<TStates>
  | EntryStateNode<TContext, TStates, unknown>;

/**
 * A looser state node type for input validation - preserves entry function types
 */
export type InputStateNode<TContext> =
  | {
      on?: Record<string, { target: string }>;
      entry?: undefined;
      onSuccess?: undefined;
      onError?: undefined;
    }
  | {
      on?: Record<string, { target: string }>;
      // biome-ignore lint/suspicious/noExplicitAny: Need any to preserve the actual event type from user input
      entry: (ctx: TContext, event: any) => TContext | Promise<TContext>;
      onSuccess: { target: string };
      onError?: { target: string };
    };

// ============================================================
// Machine Config Types
// ============================================================

/**
 * Machine configuration
 */
export interface MachineConfig<
  TContext,
  TStates extends string,
  TStateNodes extends Record<TStates, StateNode<TContext, TStates>>,
> {
  initial: TStates;
  states: TStateNodes;
}

/**
 * Input config type for looser inference
 */
export interface InputMachineConfig<TStateNodes> {
  initial: string;
  states: TStateNodes;
}

// ============================================================
// Type Utilities for Inference
// ============================================================

/**
 * Extract state names from config
 */
export type InferStates<TConfig> =
  TConfig extends MachineConfig<
    infer _TContext,
    infer TStates,
    infer _TStateNodes
  >
    ? TStates
    : never;

/**
 * Extract all event names from state nodes
 */
export type InferEvents<TStateNodes> =
  TStateNodes extends Record<string, { on?: infer TOn }>
    ? TOn extends Record<string, unknown>
      ? keyof TOn
      : never
    : never;

/**
 * Extract events from config
 */
export type InferEventsFromConfig<TConfig> =
  TConfig extends MachineConfig<
    infer _TContext,
    infer _TStates,
    infer TStateNodes
  >
    ? {
        [K in keyof TStateNodes]: TStateNodes[K] extends { on?: infer TOn }
          ? TOn extends Record<string, unknown>
            ? keyof TOn
            : never
          : never;
      }[keyof TStateNodes]
    : never;

/**
 * Extract events from state nodes record
 */
export type InferEventsFromStateNodes<TStateNodes> = {
  [K in keyof TStateNodes]: TStateNodes[K] extends { on?: infer TOn }
    ? TOn extends Record<string, unknown>
      ? keyof TOn
      : never
    : never;
}[keyof TStateNodes];

/**
 * Find target state for an event from any state
 * Iterates through all states and finds which ones define a transition for TEvent
 */
export type TargetStateForEvent<TStateNodes, TEvent extends string> = {
  [K in keyof TStateNodes]: TStateNodes[K] extends {
    on: { [E in TEvent]: { target: infer Target } };
  }
    ? Target
    : never;
}[keyof TStateNodes];

/**
 * Extract payload type from entry function of a state
 * Uses 'any' for ctx to match any context type in the entry function
 */
export type ExtractEntryPayload<TStateNode> = TStateNode extends {
  // biome-ignore lint/suspicious/noExplicitAny: Need any to match any context type
  entry: (ctx: any, event: infer TPayload) => any;
}
  ? TPayload
  : undefined;

/**
 * Get payload for an event by looking at target state's entry function
 */
export type PayloadForEvent<
  TStateNodes,
  TEvent extends string,
> = TargetStateForEvent<TStateNodes, TEvent> extends infer TTarget
  ? TTarget extends keyof TStateNodes
    ? ExtractEntryPayload<TStateNodes[TTarget]>
    : undefined
  : undefined;

// ============================================================
// Machine Definition (returned by machine())
// ============================================================

export interface MachineDefinition<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
> {
  config: {
    initial: TStates;
    states: TStateNodes;
  };
  _types: {
    context: TContext;
    states: TStates;
    events: TEvents;
  };
}

// ============================================================
// Snapshot and Adapter
// ============================================================

export interface Snapshot<TContext, TStates extends string> {
  id: string;
  state: TStates;
  context: TContext;
  createdAt: Date;
  updatedAt: Date;
}

export interface Adapter<TContext, TStates extends string> {
  load(id: string): Promise<Snapshot<TContext, TStates> | null>;
  create(
    id: string,
    state: TStates,
    context: TContext,
  ): Promise<Snapshot<TContext, TStates>>;
  save(snapshot: Snapshot<TContext, TStates>): Promise<void>;
}

// ============================================================
// Actor Interface
// ============================================================

/**
 * Actor send method - payload is required if target state has entry, otherwise no payload
 */
export type ActorSendMethod<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
> = <E extends TEvents>(
  ...args: PayloadForEvent<TStateNodes, E & string> extends undefined
    ? [event: E]
    : [event: E, payload: PayloadForEvent<TStateNodes, E & string>]
) => Promise<Actor<TContext, TStates, TEvents, TStateNodes>>;

export interface Actor<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
> {
  readonly id: string;
  readonly state: TStates;
  readonly context: TContext;
  send: ActorSendMethod<TContext, TStates, TEvents, TStateNodes>;
}

// ============================================================
// Bound Machine Interface
// ============================================================

export interface BoundMachine<
  TContext,
  TStates extends string,
  TEvents extends string,
  TStateNodes,
> {
  createActor(
    id: string,
    context: TContext,
  ): Promise<Actor<TContext, TStates, TEvents, TStateNodes>>;
  getActor(
    id: string,
  ): Promise<Actor<TContext, TStates, TEvents, TStateNodes> | null>;
}

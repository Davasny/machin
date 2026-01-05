// Core machine factory

// Actor factory (for custom adapters)
export { createActorFromSnapshot } from "./actor.js";
// Errors
export { ActorAlreadyExistsError } from "./errors.js";
export { machine } from "./machine.js";

// Types
export type {
  Actor,
  Adapter,
  BoundMachine,
  EntryStateNode,
  ExtractEntryPayload,
  InferEventsFromConfig,
  // Type utilities
  InferStates,
  MachineConfig,
  MachineDefinition,
  PayloadForEvent,
  SimpleStateNode,
  Snapshot,
  StateNode,
  TransitionTarget,
} from "./types.js";

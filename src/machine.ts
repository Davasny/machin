import type {
  InferEventsFromStateNodes,
  InputStateNode,
  MachineDefinition,
  ValidatedMachineConfig,
} from "./types.js";

/**
 * Creates a state machine definition with explicit context type.
 *
 * @returns A builder to define the machine configuration
 *
 * @example
 * ```ts
 * type MyContext = { count: number };
 *
 * const myMachine = machine<MyContext>().define({
 *   initial: "idle",
 *   states: {
 *     idle: { on: { start: { target: "running" } } },
 *     running: { on: { stop: { target: "idle" } } },
 *   },
 * });
 *
 * // Context is provided at actor creation time:
 * const actor = await boundMachine.createActor("my-id", { count: 0 });
 * ```
 */
export function machine<TContext>(): {
  define<const TStateNodes extends Record<string, InputStateNode<TContext>>>(
    config: ValidatedMachineConfig<
      TContext,
      TStateNodes,
      keyof TStateNodes & string
    > extends {
      __error: string;
    }
      ? ValidatedMachineConfig<
          TContext,
          TStateNodes,
          keyof TStateNodes & string
        >
      : {
          initial: keyof TStateNodes & string;
          states: TStateNodes;
        },
  ): MachineDefinition<
    TContext,
    keyof TStateNodes & string,
    InferEventsFromStateNodes<TStateNodes> & string,
    TStateNodes
  >;
} {
  return {
    define(config) {
      return {
        config: config as {
          initial: string;
          states: Record<string, InputStateNode<TContext>>;
        },
        _types: {} as {
          context: TContext;
          states: string;
          events: string;
        },
        // biome-ignore lint/suspicious/noExplicitAny: Return type is properly typed via function signature
      } as any;
    },
  };
}

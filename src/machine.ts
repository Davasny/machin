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
 *   context: { count: 0 },
 *   states: {
 *     idle: { on: { start: { target: "running" } } },
 *     running: { on: { stop: { target: "idle" } } },
 *   },
 * });
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
          context: NoInfer<TContext>;
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
          context: TContext;
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

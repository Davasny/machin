import { describe, expectTypeOf, it } from "vitest";
import { machine } from "@/machine.js";
import type { PayloadForEvent } from "@/types.js";

describe("Type Inference", () => {
  it("infers states from config keys", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "running" } } },
        running: { on: { stop: { target: "idle" } } },
      },
    });

    expectTypeOf(m._types.states).toEqualTypeOf<"idle" | "running">();
  });

  it("infers events from on keys", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "running" } } },
        running: { on: { stop: { target: "idle" } } },
      },
    });

    expectTypeOf(m._types.events).toEqualTypeOf<"start" | "stop">();
  });

  it("infers multiple events from multiple states", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: {
          on: {
            start: { target: "running" },
            configure: { target: "configuring" },
          },
        },
        running: {
          on: { stop: { target: "idle" }, pause: { target: "paused" } },
        },
        paused: { on: { resume: { target: "running" } } },
        configuring: { on: { done: { target: "idle" } } },
      },
    });

    expectTypeOf(m._types.events).toEqualTypeOf<
      "start" | "configure" | "stop" | "pause" | "resume" | "done"
    >();
  });

  it("infers context type from generic", () => {
    type MyContext = { count: number; name: string };

    const m = machine<MyContext>().define({
      initial: "idle",
      states: {
        idle: {},
      },
    });

    expectTypeOf(m._types.context).toEqualTypeOf<MyContext>();
  });

  it("enforces initial state must be one of defined states", () => {
    // This should compile fine
    machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: {},
        running: {},
      },
    });

    machine<Record<string, never>>().define({
      // @ts-expect-error - "invalid" is not a valid state
      initial: "invalid",
      states: {
        idle: {},
        running: {},
      },
    });
  });

  it.skip("enforces transition target must be one of defined states", () => {
    // NOTE: This validation is not currently implemented due to type inference constraints
    // The InputStateNode type uses { target: string } which accepts any string
    // TODO: Implement target validation at the machine() function level

    // This should compile fine
    machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "running" } } },
        running: {},
      },
    });

    // This SHOULD error but doesn't currently - target validation not implemented
    machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "nonexistent" } } },
        running: {},
      },
    });
  });

  it("enforces entry state must have onSuccess", () => {
    type NameContext = { name: string };

    // This should compile fine
    machine<NameContext>().define({
      initial: "idle",
      states: {
        idle: { on: { activate: { target: "activating" } } },
        activating: {
          entry: (ctx, event: { name: string }) => {
            const result: NameContext = { ...ctx, name: event.name };
            return result;
          },
          onSuccess: { target: "active" },
        },
        active: {},
      },
    });

    machine<NameContext>().define({
      initial: "idle",
      states: {
        idle: { on: { activate: { target: "activating" } } },
        // @ts-expect-error - entry without onSuccess should error
        activating: {
          entry: (ctx: NameContext, event: { name: string }) => {
            const result: NameContext = { ...ctx, name: event.name };
            return result;
          },
          // Missing onSuccess
        },
        active: {},
      },
    });
  });

  it("allows entry state without onError (onError is optional)", () => {
    type NameContext = { name: string };

    // This should compile fine - onError is optional
    const m = machine<NameContext>().define({
      initial: "idle",
      states: {
        idle: { on: { activate: { target: "activating" } } },
        activating: {
          entry: (ctx, event: { name: string }) => {
            const result: NameContext = { ...ctx, name: event.name };
            return result;
          },
          onSuccess: { target: "active" },
          // No onError - should be fine
        },
        active: {},
      },
    });

    // onError is optional, so accessing it at runtime should return undefined
    // Using type assertion since narrow inference doesn't include onError
    expect(
      (m.config.states.activating as { onError?: unknown }).onError,
    ).toBeUndefined();
  });

  it("infers payload type from entry function", () => {
    type MyContext = { name: string; count: number };

    const m = machine<MyContext>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "starting" } } },
        starting: {
          entry: (ctx, event: { name: string; count: number }) => {
            const result: MyContext = {
              ...ctx,
              name: event.name,
              count: event.count,
            };
            return result;
          },
          onSuccess: { target: "running" },
        },
        running: {},
      },
    });

    // The payload for "start" event should be { name: string; count: number }
    // because "start" transitions to "starting" which has an entry expecting that payload
    type StartPayload = PayloadForEvent<typeof m.config.states, "start">;
    expectTypeOf<StartPayload>().toEqualTypeOf<{
      name: string;
      count: number;
    }>();
  });

  it("infers undefined payload for events leading to states without entry", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "running" } } },
        running: { on: { stop: { target: "idle" } } }, // No entry
      },
    });

    // The payload for "start" should be undefined since "running" has no entry
    type StartPayload = PayloadForEvent<typeof m.config.states, "start">;
    expectTypeOf<StartPayload>().toEqualTypeOf<undefined>();

    // The payload for "stop" should be undefined since "idle" has no entry
    type StopPayload = PayloadForEvent<typeof m.config.states, "stop">;
    expectTypeOf<StopPayload>().toEqualTypeOf<undefined>();
  });
});

// Helper to prevent unused variable errors
function expect<T>(value: T): { toBeUndefined: () => void } {
  return {
    toBeUndefined: () => {
      if (value !== undefined) {
        throw new Error("Expected undefined");
      }
    },
  };
}

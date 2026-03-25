import { describe, expectTypeOf, it } from "vitest";
import type {
  InferContext,
  InferEvents,
  InferStates,
  PayloadForEvent,
} from "@/index.js";
import { machine } from "@/machine.js";

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

  it("rejects invalid targets inside onSuccess guarded arrays", () => {
    type NameContext = { name: string };

    machine<NameContext>().define({
      initial: "idle",
      states: {
        idle: { on: { activate: { target: "activating" } } },
        activating: {
          entry: (ctx, event: { name: string }) => {
            const result: NameContext = { ...ctx, name: event.name };
            return result;
          },
          // @ts-expect-error - invalid onSuccess guarded target
          onSuccess: [
            {
              guard: (ctx) => ctx.name.length > 0,
              target: "active",
            },
            {
              target: "does_not_exist",
            },
          ],
        },
        active: {},
      },
    });
  });

  it("allows async entry with only ctx parameter alongside guarded onSuccess", () => {
    type Context = {
      orgId: string;
      ksefExpected: boolean;
      stripeInvoiceId: string;
      wFirmaInvoiceId: string | null;
      status: "pending" | "done";
      retries: number;
    };

    machine<Context>().define({
      initial: "checking",
      states: {
        checking: {
          entry: async (ctx) => ({
            ...ctx,
            status: "done" as const,
          }),
          onSuccess: [
            {
              guard: (ctx) => ctx.status === "done",
              target: "done",
            },
            { target: "checking" },
          ],
          onError: { target: "failed" },
        },
        done: {},
        failed: {},
      },
    });
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

  it("infers payload types for guarded event transitions", () => {
    type MyContext = { name: string; attempts: number };

    const m = machine<MyContext>().define({
      initial: "idle",
      states: {
        idle: {
          on: {
            start: [
              {
                guard: (ctx, payload) => {
                  const typedContext: MyContext = ctx;
                  const typedPayload: { name: string; attempts: number } =
                    payload;
                  return typedPayload.attempts > typedContext.attempts;
                },
                target: "starting",
              },
              { target: "starting" },
            ],
          },
        },
        starting: {
          entry: (ctx, event: { name: string; attempts: number }) => ({
            ...ctx,
            name: event.name,
            attempts: event.attempts,
          }),
          onSuccess: [
            {
              guard: (ctx) => {
                expectTypeOf(ctx).toEqualTypeOf<MyContext>();
                return ctx.attempts > 0;
              },
              target: "running",
            },
            { target: "idle" },
          ],
          onError: [
            {
              guard: (_ctx, error) => {
                expectTypeOf(error).toEqualTypeOf<unknown>();
                return error instanceof Error;
              },
              target: "failed",
            },
          ],
        },
        running: {},
        failed: {},
      },
    });

    type StartPayload = PayloadForEvent<typeof m.config.states, "start">;
    expectTypeOf<StartPayload>().toEqualTypeOf<{
      name: string;
      attempts: number;
    }>();
  });

  it("infers union payloads when guarded branches target different entry payloads", () => {
    type MyContext = { status: string };

    const m = machine<MyContext>().define({
      initial: "idle",
      states: {
        idle: {
          on: {
            begin: [
              {
                guard: (_ctx, payload) => {
                  const typedPayload:
                    | { invoiceId: string }
                    | { customerId: string } = payload;
                  return "invoiceId" in typedPayload;
                },
                target: "invoice_flow",
              },
              { target: "customer_flow" },
            ],
          },
        },
        invoice_flow: {
          entry: (ctx, event: { invoiceId: string }) => ({
            ...ctx,
            status: event.invoiceId,
          }),
          onSuccess: { target: "done" },
        },
        customer_flow: {
          entry: (ctx, event: { customerId: string }) => ({
            ...ctx,
            status: event.customerId,
          }),
          onSuccess: { target: "done" },
        },
        done: {},
      },
    });

    type BeginPayload = PayloadForEvent<typeof m.config.states, "begin">;
    expectTypeOf<BeginPayload>().toEqualTypeOf<
      { invoiceId: string } | { customerId: string }
    >();
  });
});

describe("Exported Infer Type Utilities", () => {
  it("InferStates produces correct state union", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "loading" } } },
        loading: {
          on: { succeed: { target: "success" }, fail: { target: "error" } },
        },
        success: { on: { reset: { target: "idle" } } },
        error: { on: { reset: { target: "idle" } } },
      },
    });

    type States = InferStates<typeof m>;
    expectTypeOf<States>().toEqualTypeOf<
      "idle" | "loading" | "success" | "error"
    >();
  });

  it("InferEvents produces correct event union", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "loading" } } },
        loading: {
          on: { succeed: { target: "success" }, fail: { target: "error" } },
        },
        success: { on: { reset: { target: "idle" } } },
        error: { on: { reset: { target: "idle" } } },
      },
    });

    type Events = InferEvents<typeof m>;
    expectTypeOf<Events>().toEqualTypeOf<
      "start" | "succeed" | "fail" | "reset"
    >();
  });

  it("InferContext produces correct context type", () => {
    type MyContext = { count: number; name: string };

    const m = machine<MyContext>().define({
      initial: "idle",
      states: {
        idle: {},
      },
    });

    type Context = InferContext<typeof m>;
    expectTypeOf<Context>().toEqualTypeOf<MyContext>();
  });

  it("InferStates equals machine._types.states", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "running" } } },
        running: { on: { stop: { target: "idle" } } },
      },
    });

    type InferredStates = InferStates<typeof m>;
    type TypesStates = typeof m._types.states;

    expectTypeOf<InferredStates>().toEqualTypeOf<TypesStates>();
  });

  it("InferEvents equals machine._types.events", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: { on: { start: { target: "running" } } },
        running: { on: { stop: { target: "idle" } } },
      },
    });

    type InferredEvents = InferEvents<typeof m>;
    type TypesEvents = typeof m._types.events;

    expectTypeOf<InferredEvents>().toEqualTypeOf<TypesEvents>();
  });

  it("InferContext equals machine._types.context", () => {
    type MyContext = { count: number; name: string };

    const m = machine<MyContext>().define({
      initial: "idle",
      states: {
        idle: {},
      },
    });

    type InferredContext = InferContext<typeof m>;
    type TypesContext = typeof m._types.context;

    expectTypeOf<InferredContext>().toEqualTypeOf<TypesContext>();
  });

  it("Edge case: single state with no events", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      states: {
        idle: {},
      },
    });

    type States = InferStates<typeof m>;
    type Events = InferEvents<typeof m>;

    expectTypeOf<States>().toEqualTypeOf<"idle">();
    expectTypeOf<Events>().toEqualTypeOf<never>();
  });

  it("Edge case: complex context with optional and nested fields", () => {
    type ComplexContext = {
      user: { id: string; name?: string };
      settings?: { theme: string };
    };

    const m = machine<ComplexContext>().define({
      initial: "idle",
      states: {
        idle: {},
      },
    });

    type Context = InferContext<typeof m>;
    expectTypeOf<Context>().toEqualTypeOf<ComplexContext>();
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

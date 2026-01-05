import { describe, expect, it } from "vitest";
import { machine } from "../machine.js";

describe("machine()", () => {
  it("creates a machine definition with valid config", () => {
    type CountContext = { count: number };

    const m = machine<CountContext>().define({
      initial: "idle",
      context: { count: 0 },
      states: {
        idle: { on: { start: { target: "running" } } },
        running: { on: { stop: { target: "idle" } } },
      },
    });

    expect(m.config.initial).toBe("idle");
    expect(m.config.context).toEqual({ count: 0 });
    expect(m.config.states).toHaveProperty("idle");
    expect(m.config.states).toHaveProperty("running");
  });

  it("creates a machine with entry functions", () => {
    type NameContext = { name: string };

    const m = machine<NameContext>().define({
      initial: "inactive",
      context: { name: "" },
      states: {
        inactive: { on: { activate: { target: "activating" } } },
        activating: {
          entry: (ctx, event: { name: string }) => {
            const result: NameContext = { ...ctx, name: event.name };
            return result;
          },
          onSuccess: { target: "active" },
          onError: { target: "failed" },
        },
        active: { on: { deactivate: { target: "inactive" } } },
        failed: { on: { retry: { target: "activating" } } },
      },
    });

    expect(m.config.initial).toBe("inactive");
    expect(m.config.states.activating.entry).toBeDefined();
    expect(m.config.states.activating.onSuccess?.target).toBe("active");
    expect(m.config.states.activating.onError?.target).toBe("failed");
  });

  it("creates a machine with async entry functions", () => {
    type DataContext = { data: string | null };

    const m = machine<DataContext>().define({
      initial: "idle",
      context: { data: null },
      states: {
        idle: { on: { fetch: { target: "loading" } } },
        loading: {
          entry: async (ctx, _event: { url: string }) => {
            // Simulate async operation
            const result: DataContext = { ...ctx, data: "loaded" };
            return result;
          },
          onSuccess: { target: "success" },
          onError: { target: "error" },
        },
        success: { on: { reset: { target: "idle" } } },
        error: { on: { retry: { target: "loading" } } },
      },
    });

    expect(m.config.states.loading?.entry).toBeDefined();
  });

  it("preserves initial context value", () => {
    type NestedContext = {
      count: number;
      name: string;
      nested: { value: boolean };
    };

    const initialContext: NestedContext = {
      count: 42,
      name: "test",
      nested: { value: true },
    };
    const m = machine<NestedContext>().define({
      initial: "idle",
      context: initialContext,
      states: {
        idle: {},
      },
    });

    expect(m.config.context).toEqual(initialContext);
    expect(m.config.context).toBe(initialContext); // Same reference
  });

  it("allows states without any transitions", () => {
    const m = machine<Record<string, never>>().define({
      initial: "terminal",
      context: {},
      states: {
        terminal: {}, // No `on`, no `entry`
      },
    });

    expect(m.config.states.terminal).toEqual({});
  });

  it("allows multiple events in a single state", () => {
    const m = machine<Record<string, never>>().define({
      initial: "idle",
      context: {},
      states: {
        idle: {
          on: {
            start: { target: "running" },
            configure: { target: "configuring" },
          },
        },
        running: { on: { stop: { target: "idle" } } },
        configuring: { on: { done: { target: "idle" } } },
      },
    });

    expect(m.config.states.idle.on).toHaveProperty("start");
    expect(m.config.states.idle.on).toHaveProperty("configure");
  });

  it("allows self-transitions", () => {
    type CountContext = { count: number };

    const m = machine<CountContext>().define({
      initial: "counting",
      context: { count: 0 },
      states: {
        counting: {
          on: { increment: { target: "counting" } }, // Self-transition
        },
      },
    });

    expect(m.config.states.counting.on?.increment.target).toBe("counting");
  });
});

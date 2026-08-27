import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActorFromSnapshot } from "@/actor.js";
import { machine } from "@/machine.js";
import type { Adapter, Snapshot } from "@/types.js";

describe("Actor", () => {
  // Simple machine for basic tests
  type SimpleContext = { count: number };
  const simpleMachine = machine<SimpleContext>().define({
    initial: "idle",
    states: {
      idle: { on: { start: { target: "running" } } },
      running: { on: { stop: { target: "idle" } } },
    },
  });

  // Machine with entry functions
  type EntryContext = { name: string; count: number };
  const entryMachine = machine<EntryContext>().define({
    initial: "inactive",
    states: {
      inactive: { on: { activate: { target: "activating" } } },
      activating: {
        entry: (ctx, event: { name: string }) => {
          const result: EntryContext = {
            ...ctx,
            name: event.name,
            count: ctx.count + 1,
          };
          return result;
        },
        onSuccess: { target: "active" },
        onError: { target: "failed" },
      },
      active: { on: { deactivate: { target: "inactive" } } },
      failed: { on: { retry: { target: "activating" } } },
    },
  });

  // Machine with async entry
  type AsyncContext = { data: string | null };
  const asyncMachine = machine<AsyncContext>().define({
    initial: "idle",
    states: {
      idle: { on: { fetch: { target: "loading" } } },
      loading: {
        entry: async (ctx, event: { url: string }) => {
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 10));
          const result: AsyncContext = {
            ...ctx,
            data: `loaded from ${event.url}`,
          };
          return result;
        },
        onSuccess: { target: "success" },
        onError: { target: "error" },
      },
      success: { on: { reset: { target: "idle" } } },
      error: { on: { retry: { target: "loading" } } },
    },
  });

  // Machine with entry that throws
  type ErrorContext = { error: string | null };
  const errorMachine = machine<ErrorContext>().define({
    initial: "idle",
    states: {
      idle: { on: { process: { target: "processing" } } },
      processing: {
        entry: (_ctx, event: { shouldFail: boolean }) => {
          if (event.shouldFail) {
            throw new Error("Processing failed");
          }
          const result: ErrorContext = { error: null };
          return result;
        },
        onSuccess: { target: "done" },
        onError: { target: "failed" },
      },
      done: {},
      failed: { on: { retry: { target: "processing" } } },
    },
  });

  let mockAdapter: Adapter<unknown, string>;
  let savedSnapshots: Snapshot<unknown, string>[];

  beforeEach(() => {
    savedSnapshots = [];
    mockAdapter = {
      load: vi.fn(),
      create: vi.fn(),
      save: vi.fn().mockImplementation((snapshot) => {
        savedSnapshots.push(snapshot);
        return Promise.resolve();
      }),
    };
  });

  describe("send() with simple transitions", () => {
    it("transitions to target state on valid event", async () => {
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-1",
        state: "idle",
        errorMessage: "",
        context: { count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        simpleMachine,
        mockAdapter as Adapter<SimpleContext, "idle" | "running">,
      );

      expect(actor.state).toBe("idle");

      const newActor = await actor.send("start");

      expect(newActor.state).toBe("running");
      expect(newActor.id).toBe("test-1");
    });

    it("returns same actor on unhandled event (no-op)", async () => {
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-1",
        state: "idle",
        errorMessage: "",
        context: { count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        simpleMachine,
        mockAdapter as Adapter<SimpleContext, "idle" | "running">,
      );

      // "stop" is not handled in "idle" state
      const sameActor = await actor.send("stop");

      expect(sameActor).toBe(actor);
      expect(sameActor.state).toBe("idle");
      expect(mockAdapter.save).not.toHaveBeenCalled();
    });

    it("persists state change via adapter", async () => {
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-1",
        state: "idle",
        errorMessage: "",
        context: { count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        simpleMachine,
        mockAdapter as Adapter<SimpleContext, "idle" | "running">,
      );

      await actor.send("start");

      expect(mockAdapter.save).toHaveBeenCalledTimes(1);
      expect(savedSnapshots[0]?.state).toBe("running");
    });
  });

  describe("send() with entry functions", () => {
    it("executes entry function and updates context", async () => {
      const snapshot: Snapshot<
        EntryContext,
        "inactive" | "activating" | "active" | "failed"
      > = {
        id: "test-2",
        state: "inactive",
        errorMessage: "",
        context: { name: "", count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        entryMachine,
        mockAdapter as Adapter<
          EntryContext,
          "inactive" | "activating" | "active" | "failed"
        >,
      );

      const newActor = await actor.send("activate", { name: "MyActor" });

      // Should be in "active" state (onSuccess target)
      expect(newActor.state).toBe("active");
      expect(newActor.context.name).toBe("MyActor");
      expect(newActor.context.count).toBe(1);
    });

    it("transitions to onSuccess target after successful entry", async () => {
      const snapshot: Snapshot<
        EntryContext,
        "inactive" | "activating" | "active" | "failed"
      > = {
        id: "test-2",
        state: "inactive",
        errorMessage: "",
        context: { name: "", count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        entryMachine,
        mockAdapter as Adapter<
          EntryContext,
          "inactive" | "activating" | "active" | "failed"
        >,
      );

      const newActor = await actor.send("activate", { name: "Test" });

      expect(newActor.state).toBe("active");
    });

    it("transitions to onError target when entry throws", async () => {
      const snapshot: Snapshot<
        ErrorContext,
        "idle" | "processing" | "done" | "failed"
      > = {
        id: "test-3",
        state: "idle",
        errorMessage: "",
        context: { error: null },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        errorMachine,
        mockAdapter as Adapter<
          ErrorContext,
          "idle" | "processing" | "done" | "failed"
        >,
      );

      const newActor = await actor.send("process", { shouldFail: true });

      expect(newActor.state).toBe("failed");
    });

    it("stores thrown entry error message on the actor snapshot", async () => {
      type Context = { result: string | null };

      const m = machine<Context>().define({
        initial: "idle",
        states: {
          idle: { on: { process: { target: "processing" } } },
          processing: {
            entry: () => {
              throw new Error("boom");
            },
            onSuccess: { target: "done" },
            onError: {
              target: "failed",
            },
          },
          done: {},
          failed: {},
        },
      });

      const actor = createActorFromSnapshot(
        {
          id: "test-error-context-1",
          state: "idle",
          errorMessage: "",
          context: { result: null },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        m,
        mockAdapter as Adapter<
          Context,
          "idle" | "processing" | "done" | "failed"
        >,
      );

      const newActor = await actor.send("process", {});

      expect(newActor.state).toBe("failed");
      expect(newActor.context).toEqual({ result: null });
      expect(savedSnapshots[0]?.errorMessage).toBe("");
      expect(savedSnapshots[1]?.errorMessage).toBe("boom");
    });

    it("stores error message when a guarded onError branch matches", async () => {
      type Context = { retryable: boolean };

      const m = machine<Context>().define({
        initial: "idle",
        states: {
          idle: { on: { process: { target: "processing" } } },
          processing: {
            entry: (_ctx, event: { code: string }) => {
              throw new Error(event.code);
            },
            onSuccess: { target: "done" },
            onError: [
              {
                guard: (_ctx, error) =>
                  error instanceof Error && error.message === "retryable",
                target: "retryable_failed",
              },
              {
                target: "failed",
              },
            ],
          },
          done: {},
          retryable_failed: {},
          failed: {},
        },
      });

      const actor = createActorFromSnapshot(
        {
          id: "test-error-context-2",
          state: "idle",
          errorMessage: "",
          context: { retryable: false },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        m,
        mockAdapter as Adapter<
          Context,
          "idle" | "processing" | "done" | "retryable_failed" | "failed"
        >,
      );

      const newActor = await actor.send("process", { code: "retryable" });

      expect(newActor.state).toBe("retryable_failed");
      expect(savedSnapshots[0]?.errorMessage).toBe("");
      expect(savedSnapshots[1]?.errorMessage).toBe("retryable");
      expect(newActor.context).toEqual({ retryable: false });
    });

    it("re-throws when no onError branch matches (entry state still persisted)", async () => {
      type Context = { error: string | null };

      const m = machine<Context>().define({
        initial: "idle",
        states: {
          idle: { on: { process: { target: "processing" } } },
          processing: {
            entry: () => {
              throw new Error("fatal");
            },
            onSuccess: { target: "done" },
            onError: [
              {
                guard: (_ctx, error) =>
                  error instanceof Error && error.message === "retryable",
                target: "failed",
              },
            ],
          },
          done: {},
          failed: {},
        },
      });

      const actor = createActorFromSnapshot(
        {
          id: "test-error-context-3",
          state: "idle",
          errorMessage: "",
          context: { error: null },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        m,
        mockAdapter as Adapter<
          Context,
          "idle" | "processing" | "done" | "failed"
        >,
      );

      await expect(actor.send("process", {})).rejects.toThrow("fatal");
      // Write-ahead: the entering state is persisted even when the entry fails fatal
      expect(mockAdapter.save).toHaveBeenCalledTimes(1);
      expect(savedSnapshots[0]?.state).toBe("processing");
      expect(actor.context).toEqual({ error: null });
    });

    it("calls onActorError with a payload of id, failed entry state, error, and original context", async () => {
      type Context = { error: string | null };
      const onActorError = vi.fn();

      const m = machine<Context>().define({
        initial: "idle",
        states: {
          idle: { on: { process: { target: "processing" } } },
          processing: {
            entry: () => {
              throw new Error("observed");
            },
            onSuccess: { target: "done" },
            onError: {
              target: "failed",
            },
          },
          done: {},
          failed: {},
        },
        onActorError,
      });

      const originalContext = { error: null };
      const actor = createActorFromSnapshot(
        {
          id: "test-error-hook-1",
          state: "idle",
          errorMessage: "",
          context: originalContext,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        m,
        mockAdapter as Adapter<
          Context,
          "idle" | "processing" | "done" | "failed"
        >,
      );

      const newActor = await actor.send("process", {});

      expect(newActor.context.error).toBe(null);
      expect(savedSnapshots[0]?.errorMessage).toBe("");
      expect(savedSnapshots[1]?.errorMessage).toBe("observed");
      expect(onActorError).toHaveBeenCalledTimes(1);
      expect(onActorError.mock.calls[0]?.[0]).toEqual({
        id: "test-error-hook-1",
        state: "processing",
        error: expect.any(Error),
        context: originalContext,
      });
    });

    it("swallows onActorError exceptions and continues the onError transition", async () => {
      type Context = { error: string | null };

      const m = machine<Context>().define({
        initial: "idle",
        states: {
          idle: { on: { process: { target: "processing" } } },
          processing: {
            entry: () => {
              throw new Error("entry failed");
            },
            onSuccess: { target: "done" },
            onError: {
              target: "failed",
            },
          },
          done: {},
          failed: {},
        },
        onActorError: () => {
          throw new Error("logger failed");
        },
      });

      const actor = createActorFromSnapshot(
        {
          id: "test-error-hook-2",
          state: "idle",
          errorMessage: "",
          context: { error: null },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        m,
        mockAdapter as Adapter<
          Context,
          "idle" | "processing" | "done" | "failed"
        >,
      );

      const newActor = await actor.send("process", {});

      expect(newActor.state).toBe("failed");
      expect(newActor.context.error).toBe(null);
      expect(savedSnapshots[0]?.errorMessage).toBe("");
      expect(savedSnapshots[1]?.errorMessage).toBe("entry failed");
    });

    it("transitions to onSuccess when entry succeeds", async () => {
      const snapshot: Snapshot<
        ErrorContext,
        "idle" | "processing" | "done" | "failed"
      > = {
        id: "test-3",
        state: "idle",
        errorMessage: "",
        context: { error: null },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        errorMachine,
        mockAdapter as Adapter<
          ErrorContext,
          "idle" | "processing" | "done" | "failed"
        >,
      );

      const newActor = await actor.send("process", { shouldFail: false });

      expect(newActor.state).toBe("done");
    });
  });

  describe("send() with async entry functions", () => {
    it("handles async entry function", async () => {
      const snapshot: Snapshot<
        AsyncContext,
        "idle" | "loading" | "success" | "error"
      > = {
        id: "test-4",
        state: "idle",
        errorMessage: "",
        context: { data: null },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        asyncMachine,
        mockAdapter as Adapter<
          AsyncContext,
          "idle" | "loading" | "success" | "error"
        >,
      );

      const newActor = await actor.send("fetch", {
        url: "https://example.com",
      });

      expect(newActor.state).toBe("success");
      expect(newActor.context.data).toBe("loaded from https://example.com");
    });
  });

  describe("nextEvents", () => {
    it("returns unguarded events for the current state", () => {
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-next-events-1",
        state: "idle",
        errorMessage: "",
        context: { count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        simpleMachine,
        mockAdapter as Adapter<SimpleContext, "idle" | "running">,
      );

      expect(actor.nextEvents).toEqual(["start"]);
    });

    it("returns only guarded events available from current context", () => {
      type GuardedContext = { enabled: boolean };

      const guardedMachine = machine<GuardedContext>().define({
        initial: "idle",
        states: {
          idle: {
            on: {
              activate: [
                {
                  guard: (ctx) => ctx.enabled,
                  target: "active",
                },
              ],
              disable: { target: "disabled" },
            },
          },
          active: {},
          disabled: {},
        },
      });

      const disabledActor = createActorFromSnapshot(
        {
          id: "test-next-events-2",
          state: "idle",
          errorMessage: "",
          context: { enabled: false },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        guardedMachine,
        mockAdapter as Adapter<GuardedContext, "idle" | "active" | "disabled">,
      );

      const enabledActor = createActorFromSnapshot(
        {
          id: "test-next-events-3",
          state: "idle",
          errorMessage: "",
          context: { enabled: true },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        guardedMachine,
        mockAdapter as Adapter<GuardedContext, "idle" | "active" | "disabled">,
      );

      expect(disabledActor.nextEvents).toEqual(["disable"]);
      expect(enabledActor.nextEvents).toEqual(["activate", "disable"]);
    });

    it("includes payload-required events by name", () => {
      const snapshot: Snapshot<
        EntryContext,
        "inactive" | "activating" | "active" | "failed"
      > = {
        id: "test-next-events-4",
        state: "inactive",
        errorMessage: "",
        context: { name: "", count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        entryMachine,
        mockAdapter as Adapter<
          EntryContext,
          "inactive" | "activating" | "active" | "failed"
        >,
      );

      expect(actor.nextEvents).toEqual(["activate"]);
    });

    it("returns an empty array when the current state has no outgoing events", () => {
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-next-events-5",
        state: "running",
        errorMessage: "",
        context: { count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        simpleMachine,
        mockAdapter as Adapter<SimpleContext, "idle" | "running">,
      );

      expect(actor.nextEvents).toEqual(["stop"]);

      const terminalMachine = machine<Record<string, never>>().define({
        initial: "done",
        states: {
          done: {},
        },
      });

      const terminalActor = createActorFromSnapshot(
        {
          id: "test-next-events-6",
          state: "done",
          errorMessage: "",
          context: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        terminalMachine,
        mockAdapter as Adapter<Record<string, never>, "done">,
      );

      expect(terminalActor.nextEvents).toEqual([]);
    });

    it("refreshes nextEvents on the new immutable actor returned by send", async () => {
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-next-events-7",
        state: "idle",
        errorMessage: "",
        context: { count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        simpleMachine,
        mockAdapter as Adapter<SimpleContext, "idle" | "running">,
      );

      const nextActor = await actor.send("start");

      expect(actor.nextEvents).toEqual(["start"]);
      expect(nextActor.nextEvents).toEqual(["stop"]);
    });
  });

  describe("Actor immutability", () => {
    it("send returns a new Actor instance", async () => {
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-1",
        state: "idle",
        errorMessage: "",
        context: { count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        simpleMachine,
        mockAdapter as Adapter<SimpleContext, "idle" | "running">,
      );

      const newActor = await actor.send("start");

      expect(newActor).not.toBe(actor);
      expect(actor.state).toBe("idle"); // Original unchanged
      expect(newActor.state).toBe("running");
    });

    it("preserves createdAt from original snapshot", async () => {
      const originalCreatedAt = new Date("2024-01-01");
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-1",
        state: "idle",
        errorMessage: "",
        context: { count: 0 },
        createdAt: originalCreatedAt,
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        simpleMachine,
        mockAdapter as Adapter<SimpleContext, "idle" | "running">,
      );

      await actor.send("start");

      expect(savedSnapshots[0]?.createdAt).toBe(originalCreatedAt);
    });

    it("updates updatedAt on each transition", async () => {
      const originalUpdatedAt = new Date("2024-01-01");
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-1",
        state: "idle",
        errorMessage: "",
        context: { count: 0 },
        createdAt: new Date(),
        updatedAt: originalUpdatedAt,
      };

      const actor = createActorFromSnapshot(
        snapshot,
        simpleMachine,
        mockAdapter as Adapter<SimpleContext, "idle" | "running">,
      );

      const beforeSend = new Date();
      await actor.send("start");
      const afterSend = new Date();

      const savedUpdatedAt = savedSnapshots[0]?.updatedAt;
      expect(savedUpdatedAt).toBeDefined();
      expect(savedUpdatedAt!.getTime()).toBeGreaterThanOrEqual(
        beforeSend.getTime(),
      );
      expect(savedUpdatedAt!.getTime()).toBeLessThanOrEqual(
        afterSend.getTime(),
      );
    });
  });

  describe("Edge cases", () => {
    it("handles entry that returns same context", async () => {
      type ValueContext = { value: number };

      const sameContextMachine = machine<ValueContext>().define({
        initial: "a",
        states: {
          a: { on: { go: { target: "b" } } },
          b: {
            entry: (ctx, _event: Record<string, never>) => ctx, // Return same context
            onSuccess: { target: "c" },
          },
          c: {},
        },
      });

      const snapshot: Snapshot<ValueContext, "a" | "b" | "c"> = {
        id: "test-5",
        state: "a",
        errorMessage: "",
        context: { value: 42 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        sameContextMachine,
        mockAdapter as Adapter<ValueContext, "a" | "b" | "c">,
      );

      const newActor = await actor.send("go", {});

      expect(newActor.state).toBe("c");
      expect(newActor.context.value).toBe(42);
    });

    it("re-throws error when no onError is defined", async () => {
      const noOnErrorMachine = machine<Record<string, never>>().define({
        initial: "idle",
        states: {
          idle: { on: { fail: { target: "failing" } } },
          failing: {
            entry: () => {
              throw new Error("Intentional error");
            },
            onSuccess: { target: "done" },
            // No onError
          },
          done: {},
        },
      });

      const snapshot: Snapshot<
        Record<string, never>,
        "idle" | "failing" | "done"
      > = {
        id: "test-6",
        state: "idle",
        errorMessage: "",
        context: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        noOnErrorMachine,
        mockAdapter as Adapter<
          Record<string, never>,
          "idle" | "failing" | "done"
        >,
      );

      await expect(actor.send("fail", {})).rejects.toThrow("Intentional error");
    });

    it("handles self-transitions and re-runs entry", async () => {
      type CountContext = { count: number };

      const selfTransitionMachine = machine<CountContext>().define({
        initial: "counting",
        states: {
          counting: {
            on: { increment: { target: "incrementing" } },
          },
          incrementing: {
            entry: (ctx, _event: Record<string, never>) => {
              const result: CountContext = { count: ctx.count + 1 };
              return result;
            },
            onSuccess: { target: "counting" },
          },
        },
      });

      const snapshot: Snapshot<CountContext, "counting" | "incrementing"> = {
        id: "test-7",
        state: "counting",
        errorMessage: "",
        context: { count: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        snapshot,
        selfTransitionMachine,
        mockAdapter as Adapter<CountContext, "counting" | "incrementing">,
      );

      let currentActor = await actor.send("increment", {});
      expect(currentActor.state).toBe("counting");
      expect(currentActor.context.count).toBe(1);

      currentActor = await currentActor.send("increment", {});
      expect(currentActor.state).toBe("counting");
      expect(currentActor.context.count).toBe(2);
    });
  });
});

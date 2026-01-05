import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActorFromSnapshot } from "../actor.js";
import { machine } from "../machine.js";
import type { Adapter, Snapshot } from "../types.js";

describe("Actor", () => {
  // Simple machine for basic tests
  type SimpleContext = { count: number };
  const simpleMachine = machine<SimpleContext>().define({
    initial: "idle",
    context: { count: 0 },
    states: {
      idle: { on: { start: { target: "running" } } },
      running: { on: { stop: { target: "idle" } } },
    },
  });

  // Machine with entry functions
  type EntryContext = { name: string; count: number };
  const entryMachine = machine<EntryContext>().define({
    initial: "inactive",
    context: { name: "", count: 0 },
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
    context: { data: null },
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
    context: { error: null },
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

    it("transitions to onSuccess when entry succeeds", async () => {
      const snapshot: Snapshot<
        ErrorContext,
        "idle" | "processing" | "done" | "failed"
      > = {
        id: "test-3",
        state: "idle",
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

  describe("Actor immutability", () => {
    it("send returns a new Actor instance", async () => {
      const snapshot: Snapshot<SimpleContext, "idle" | "running"> = {
        id: "test-1",
        state: "idle",
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
        context: { value: 42 },
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
        context: {},
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
        context: { count: 0 },
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

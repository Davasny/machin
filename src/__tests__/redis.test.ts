import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RedisAdapter,
  type RedisClientLike,
  withRedis,
} from "@/adapters/redis/index.js";
import { ActorAlreadyExistsError } from "@/errors.js";
import { machine } from "@/machine.js";
import type { Snapshot } from "@/types.js";

describe("RedisAdapter", () => {
  type TestContext = { count: number; name: string };
  type TestStates = "idle" | "running";

  let mockClient: RedisClientLike;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    mockClient = {
      get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve("OK");
      }),
    };
  });

  describe("load()", () => {
    it("returns null for missing key", async () => {
      const adapter = new RedisAdapter<TestContext, TestStates>({
        client: mockClient,
      });

      const result = await adapter.load("non-existent");

      expect(result).toBeNull();
      expect(mockClient.get).toHaveBeenCalledWith("non-existent");
    });

    it("returns snapshot with hydrated Dates", async () => {
      const createdAt = new Date("2024-01-01T00:00:00.000Z");
      const updatedAt = new Date("2024-01-02T00:00:00.000Z");

      const storedSnapshot = {
        id: "test-1",
        state: "idle",
        context: { count: 5, name: "test" },
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      };
      store.set("test-1", JSON.stringify(storedSnapshot));

      const adapter = new RedisAdapter<TestContext, TestStates>({
        client: mockClient,
      });

      const result = await adapter.load("test-1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("test-1");
      expect(result?.state).toBe("idle");
      expect(result?.context).toEqual({ count: 5, name: "test" });
      expect(result?.createdAt).toBeInstanceOf(Date);
      expect(result?.updatedAt).toBeInstanceOf(Date);
      expect(result?.createdAt.toISOString()).toBe(createdAt.toISOString());
      expect(result?.updatedAt.toISOString()).toBe(updatedAt.toISOString());
    });
  });

  describe("create()", () => {
    it("stores snapshot as JSON", async () => {
      const adapter = new RedisAdapter<TestContext, TestStates>({
        client: mockClient,
      });

      const snapshot = await adapter.create("test-1", "idle", {
        count: 0,
        name: "new",
      });

      expect(mockClient.set).toHaveBeenCalledTimes(1);
      expect(mockClient.set).toHaveBeenCalledWith("test-1", expect.any(String));

      // Verify stored JSON
      const storedJson = store.get("test-1");
      expect(storedJson).toBeDefined();
      const stored = JSON.parse(storedJson!);
      expect(stored.id).toBe("test-1");
      expect(stored.state).toBe("idle");
      expect(stored.context).toEqual({ count: 0, name: "new" });

      // Verify returned snapshot
      expect(snapshot.id).toBe("test-1");
      expect(snapshot.state).toBe("idle");
      expect(snapshot.context).toEqual({ count: 0, name: "new" });
      expect(snapshot.createdAt).toBeInstanceOf(Date);
      expect(snapshot.updatedAt).toBeInstanceOf(Date);
    });

    it("sets createdAt and updatedAt to same time", async () => {
      const adapter = new RedisAdapter<TestContext, TestStates>({
        client: mockClient,
      });

      const before = new Date();
      const snapshot = await adapter.create("test-1", "idle", {
        count: 0,
        name: "new",
      });
      const after = new Date();

      expect(snapshot.createdAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(snapshot.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(snapshot.createdAt.getTime()).toBe(snapshot.updatedAt.getTime());
    });
  });

  describe("save()", () => {
    it("updates existing snapshot", async () => {
      const adapter = new RedisAdapter<TestContext, TestStates>({
        client: mockClient,
      });

      const createdAt = new Date("2024-01-01T00:00:00.000Z");
      const updatedAt = new Date("2024-01-02T00:00:00.000Z");

      const snapshot: Snapshot<TestContext, TestStates> = {
        id: "test-1",
        state: "running",
        context: { count: 10, name: "updated" },
        createdAt,
        updatedAt,
      };

      await adapter.save(snapshot);

      expect(mockClient.set).toHaveBeenCalledWith("test-1", expect.any(String));

      // Verify stored JSON
      const storedJson = store.get("test-1");
      expect(storedJson).toBeDefined();
      const stored = JSON.parse(storedJson!);
      expect(stored.id).toBe("test-1");
      expect(stored.state).toBe("running");
      expect(stored.context).toEqual({ count: 10, name: "updated" });
      expect(stored.createdAt).toBe(createdAt.toISOString());
      expect(stored.updatedAt).toBe(updatedAt.toISOString());
    });
  });
});

describe("withRedis", () => {
  type SubscriptionContext = { plan: string | null };

  const subscriptionMachine = machine<SubscriptionContext>().define({
    initial: "inactive",
    states: {
      inactive: { on: { activate: { target: "activating" } } },
      activating: {
        entry: (ctx, event: { plan: string }) => ({ ...ctx, plan: event.plan }),
        onSuccess: { target: "active" },
      },
      active: { on: { cancel: { target: "inactive" } } },
    },
  });

  let mockClient: RedisClientLike;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    mockClient = {
      get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve("OK");
      }),
    };
  });

  describe("createActor()", () => {
    it("creates a new actor and stores in Redis", async () => {
      const boundMachine = withRedis(subscriptionMachine, {
        client: mockClient,
      });

      const actor = await boundMachine.createActor("sub_123", { plan: null });

      expect(actor.id).toBe("sub_123");
      expect(actor.state).toBe("inactive");
      expect(actor.context).toEqual({ plan: null });
      expect(store.has("sub_123")).toBe(true);
    });

    it("throws ActorAlreadyExistsError if actor exists", async () => {
      const boundMachine = withRedis(subscriptionMachine, {
        client: mockClient,
      });

      await boundMachine.createActor("sub_123", { plan: null });

      await expect(
        boundMachine.createActor("sub_123", { plan: null }),
      ).rejects.toThrow(ActorAlreadyExistsError);
    });
  });

  describe("getActor()", () => {
    it("returns null for non-existent actor", async () => {
      const boundMachine = withRedis(subscriptionMachine, {
        client: mockClient,
      });

      const actor = await boundMachine.getActor("non-existent");

      expect(actor).toBeNull();
    });

    it("returns existing actor", async () => {
      const boundMachine = withRedis(subscriptionMachine, {
        client: mockClient,
      });

      await boundMachine.createActor("sub_123", { plan: null });
      const actor = await boundMachine.getActor("sub_123");

      expect(actor).not.toBeNull();
      expect(actor?.id).toBe("sub_123");
      expect(actor?.state).toBe("inactive");
    });
  });

  describe("Actor transitions with Redis persistence", () => {
    it("persists state changes to Redis", async () => {
      const boundMachine = withRedis(subscriptionMachine, {
        client: mockClient,
      });

      const actor = await boundMachine.createActor("sub_123", { plan: null });
      const activatedActor = await actor.send("activate", { plan: "pro" });

      expect(activatedActor.state).toBe("active");
      expect(activatedActor.context.plan).toBe("pro");

      // Verify persisted in Redis
      const storedJson = store.get("sub_123");
      expect(storedJson).toBeDefined();
      const stored = JSON.parse(storedJson!);
      expect(stored.state).toBe("active");
      expect(stored.context.plan).toBe("pro");
    });

    it("reloaded actor has correct state", async () => {
      const boundMachine = withRedis(subscriptionMachine, {
        client: mockClient,
      });

      const actor = await boundMachine.createActor("sub_123", { plan: null });
      await actor.send("activate", { plan: "enterprise" });

      // Reload actor from Redis
      const reloaded = await boundMachine.getActor("sub_123");

      expect(reloaded?.state).toBe("active");
      expect(reloaded?.context.plan).toBe("enterprise");
    });
  });
});

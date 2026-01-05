import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withDrizzleSQLite } from "@/adapters/drizzle/sqlite.js";
import { ActorAlreadyExistsError } from "@/errors.js";
import { machine } from "@/machine.js";

// Define a test table using SQLite types
const subscriptionsTable = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  state: text("state").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  count: integer("count").notNull(),
  name: text("name"),
});

// Type for the test context
type TestContext = {
  count: number;
  name: string | null;
};

// Test machine
const testMachine = machine<TestContext>().define({
  initial: "inactive",
  states: {
    inactive: { on: { activate: { target: "activating" } } },
    activating: {
      entry: (ctx, event: { name: string }) => {
        const result: TestContext = {
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

// Mock database helper (same pattern as pg test)
function createMockDb() {
  const storage: Map<string, Record<string, unknown>> = new Map();
  let insertedData: Record<string, unknown> | null = null;
  let updatedData: { set: Record<string, unknown>; id: string } | null = null;

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => {
            return Promise.resolve([]);
          }),
        })),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((data: Record<string, unknown>) => {
        insertedData = data;
        storage.set(data["id"] as string, data);
        return Promise.resolve();
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation(() => {
          updatedData = { set: data, id: "" };
          return Promise.resolve();
        }),
      })),
    }),
    _getInserted: () => insertedData,
    _getUpdated: () => updatedData,
    _storage: storage,
  };

  let lastQueriedId: string | null = null;

  mockDb.select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        return {
          limit: vi.fn().mockImplementation(() => {
            if (lastQueriedId && storage.has(lastQueriedId)) {
              return Promise.resolve([storage.get(lastQueriedId)]);
            }
            return Promise.resolve([]);
          }),
        };
      }),
    }),
  });

  (mockDb as Record<string, unknown>)["_setQueryId"] = (id: string) => {
    lastQueriedId = id;
  };

  return mockDb;
}

describe("withDrizzleSQLite() - SQLite", () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  describe("createActor()", () => {
    it("creates a new actor with initial state and context", async () => {
      const boundMachine = withDrizzleSQLite(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      const actor = await boundMachine.createActor("sub_123", {
        count: 0,
        name: null,
      });

      expect(actor.id).toBe("sub_123");
      expect(actor.state).toBe("inactive");
      expect(actor.context).toEqual({ count: 0, name: null });
    });

    it("persists the new actor via db.insert", async () => {
      const boundMachine = withDrizzleSQLite(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      await boundMachine.createActor("sub_123", { count: 0, name: null });

      expect(mockDb.insert).toHaveBeenCalled();
      const inserted = mockDb._getInserted();
      expect(inserted).toMatchObject({
        id: "sub_123",
        state: "inactive",
        count: 0,
        name: null,
      });
      expect(inserted?.["createdAt"]).toBeInstanceOf(Date);
      expect(inserted?.["updatedAt"]).toBeInstanceOf(Date);
    });

    it("throws ActorAlreadyExistsError if actor exists", async () => {
      mockDb._storage.set("sub_123", {
        id: "sub_123",
        state: "inactive",
        count: 0,
        name: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (mockDb as unknown as { _setQueryId: (id: string) => void })._setQueryId(
        "sub_123",
      );

      const boundMachine = withDrizzleSQLite(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      await expect(
        boundMachine.createActor("sub_123", { count: 0, name: null }),
      ).rejects.toThrow(ActorAlreadyExistsError);
      await expect(
        boundMachine.createActor("sub_123", { count: 0, name: null }),
      ).rejects.toThrow('Actor with id "sub_123" already exists');
    });
  });

  describe("getActor()", () => {
    it("returns null when actor does not exist", async () => {
      const boundMachine = withDrizzleSQLite(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      (mockDb as unknown as { _setQueryId: (id: string) => void })._setQueryId(
        "nonexistent",
      );
      const actor = await boundMachine.getActor("nonexistent");

      expect(actor).toBeNull();
    });

    it("returns actor when it exists", async () => {
      mockDb._storage.set("sub_123", {
        id: "sub_123",
        state: "active",
        count: 5,
        name: "TestActor",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-02"),
      });
      (mockDb as unknown as { _setQueryId: (id: string) => void })._setQueryId(
        "sub_123",
      );

      const boundMachine = withDrizzleSQLite(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      const actor = await boundMachine.getActor("sub_123");

      expect(actor).not.toBeNull();
      expect(actor?.id).toBe("sub_123");
      expect(actor?.state).toBe("active");
      expect(actor?.context).toEqual({ count: 5, name: "TestActor" });
    });
  });

  describe("Actor persistence", () => {
    it("persists state changes after send()", async () => {
      const updateCalls: Array<{ set: Record<string, unknown> }> = [];

      const trackingMockDb = {
        ...mockDb,
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
            where: vi.fn().mockImplementation(() => {
              updateCalls.push({ set: data });
              return Promise.resolve();
            }),
          })),
        }),
      };

      const boundMachine = withDrizzleSQLite(testMachine, {
        db: trackingMockDb,
        table: subscriptionsTable,
      });

      const actor = await boundMachine.createActor("sub_persist", {
        count: 0,
        name: null,
      });
      const newActor = await actor.send("activate", { name: "NewName" });

      expect(newActor.state).toBe("active");
      expect(newActor.context.name).toBe("NewName");
      expect(updateCalls.length).toBeGreaterThan(0);
      expect(updateCalls[0]?.set).toMatchObject({
        state: "active",
        name: "NewName",
        count: 1,
      });
    });
  });
});

describe("SQLite Type validation", () => {
  it("accepts matching context and SQLite table types", () => {
    const _boundMachine = withDrizzleSQLite(testMachine, {
      db: createMockDb(),
      table: subscriptionsTable,
    });

    expect(_boundMachine).toBeDefined();
  });
});

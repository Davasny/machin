import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withDrizzle } from "../adapters/drizzle.js";
import { ActorAlreadyExistsError } from "../errors.js";
import { machine } from "../machine.js";

// Define a test table
const subscriptionsTable = pgTable("subscriptions", {
  id: uuid().primaryKey(),
  state: text().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
  count: integer().notNull(),
  name: text(),
});

// Type for the test context
type TestContext = {
  count: number;
  name: string | null;
};

// Test machine
const testMachine = machine<TestContext>().define({
  initial: "inactive",
  context: { count: 0, name: null },
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

// Mock database helper
function createMockDb() {
  const storage: Map<string, Record<string, unknown>> = new Map();
  let insertedData: Record<string, unknown> | null = null;
  let updatedData: { set: Record<string, unknown>; id: string } | null = null;

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => {
            // Extract ID from the last call
            const whereCall = mockDb.select().from().where;
            // For simplicity, we'll track the ID differently
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
    // Helper to get inserted/updated data for assertions
    _getInserted: () => insertedData,
    _getUpdated: () => updatedData,
    _storage: storage,
  };

  // More sophisticated mock that tracks IDs
  let lastQueriedId: string | null = null;

  mockDb.select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((condition: unknown) => {
        // Try to extract ID from the condition
        // In real implementation this would parse the eq() call
        // For testing, we'll use a simpler approach
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

  // Expose a way to set the query ID for testing
  (mockDb as Record<string, unknown>)["_setQueryId"] = (id: string) => {
    lastQueriedId = id;
  };

  return mockDb;
}

describe("withDrizzle()", () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  describe("createActor()", () => {
    it("creates a new actor with initial state and context", async () => {
      const boundMachine = withDrizzle(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      const actor = await boundMachine.createActor("sub_123");

      expect(actor.id).toBe("sub_123");
      expect(actor.state).toBe("inactive");
      expect(actor.context).toEqual({ count: 0, name: null });
    });

    it("persists the new actor via db.insert", async () => {
      const boundMachine = withDrizzle(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      await boundMachine.createActor("sub_123");

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
      // Pre-populate storage
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

      const boundMachine = withDrizzle(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      await expect(boundMachine.createActor("sub_123")).rejects.toThrow(
        ActorAlreadyExistsError,
      );
      await expect(boundMachine.createActor("sub_123")).rejects.toThrow(
        'Actor with id "sub_123" already exists',
      );
    });
  });

  describe("getActor()", () => {
    it("returns null when actor does not exist", async () => {
      const boundMachine = withDrizzle(testMachine, {
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
      // Pre-populate storage
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

      const boundMachine = withDrizzle(testMachine, {
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

  describe("getOrCreateActor()", () => {
    it("creates actor when it does not exist", async () => {
      const boundMachine = withDrizzle(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      (mockDb as unknown as { _setQueryId: (id: string) => void })._setQueryId(
        "new_actor",
      );
      const actor = await boundMachine.getOrCreateActor("new_actor");

      expect(actor.id).toBe("new_actor");
      expect(actor.state).toBe("inactive");
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("returns existing actor when it exists", async () => {
      // Pre-populate storage
      mockDb._storage.set("existing_123", {
        id: "existing_123",
        state: "active",
        count: 10,
        name: "ExistingActor",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (mockDb as unknown as { _setQueryId: (id: string) => void })._setQueryId(
        "existing_123",
      );

      const boundMachine = withDrizzle(testMachine, {
        db: mockDb,
        table: subscriptionsTable,
      });

      // Clear insert calls before testing
      mockDb.insert.mockClear();

      const actor = await boundMachine.getOrCreateActor("existing_123");

      expect(actor.id).toBe("existing_123");
      expect(actor.state).toBe("active");
      expect(actor.context).toEqual({ count: 10, name: "ExistingActor" });
      // Should NOT have called insert since actor exists
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe("Actor persistence", () => {
    it("persists state changes after send()", async () => {
      // Create a fresh mock with proper tracking
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

      const boundMachine = withDrizzle(testMachine, {
        db: trackingMockDb,
        table: subscriptionsTable,
      });

      const actor = await boundMachine.createActor("sub_persist");
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

describe("Type validation", () => {
  it("accepts matching context and table types", () => {
    // This should compile without errors
    const _boundMachine = withDrizzle(testMachine, {
      db: createMockDb(),
      table: subscriptionsTable,
    });

    expect(_boundMachine).toBeDefined();
  });

  // Type-level test: mismatched context should produce error
  // This is tested in types.test.ts
});

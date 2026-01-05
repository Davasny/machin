import { describe, expect, it, vi } from "vitest";
import { createActorFromSnapshot } from "../actor.js";
import { machine } from "../machine.js";
import type { Adapter, Snapshot } from "../types.js";

describe("Transition Flows", () => {
  // Create a mock adapter for testing
  function createMockAdapter<TContext, TStates extends string>() {
    const savedSnapshots: Snapshot<TContext, TStates>[] = [];
    return {
      adapter: {
        load: vi.fn(),
        create: vi.fn(),
        save: vi
          .fn()
          .mockImplementation((snapshot: Snapshot<TContext, TStates>) => {
            savedSnapshots.push(snapshot);
            return Promise.resolve();
          }),
      } as Adapter<TContext, TStates>,
      savedSnapshots,
    };
  }

  describe("Simple state machine flow", () => {
    type TrafficLightContext = { cycleCount: number };

    const trafficLightMachine = machine<TrafficLightContext>().define({
      initial: "red",
      context: { cycleCount: 0 },
      states: {
        red: { on: { next: { target: "green" } } },
        green: { on: { next: { target: "yellow" } } },
        yellow: { on: { next: { target: "red" } } },
      },
    });

    it("completes a full cycle: red -> green -> yellow -> red", async () => {
      const { adapter } = createMockAdapter<
        TrafficLightContext,
        "red" | "green" | "yellow"
      >();

      const initialSnapshot: Snapshot<
        TrafficLightContext,
        "red" | "green" | "yellow"
      > = {
        id: "light-1",
        state: "red",
        context: { cycleCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let actor = createActorFromSnapshot(
        initialSnapshot,
        trafficLightMachine,
        adapter,
      );
      expect(actor.state).toBe("red");

      actor = await actor.send("next");
      expect(actor.state).toBe("green");

      actor = await actor.send("next");
      expect(actor.state).toBe("yellow");

      actor = await actor.send("next");
      expect(actor.state).toBe("red");
    });
  });

  describe("State machine with entry functions", () => {
    type OrderContext = {
      orderId: string;
      totalAmount: number;
      paymentId: string | null;
      error: string | null;
    };

    const orderMachine = machine<OrderContext>().define({
      initial: "pending",
      context: {
        orderId: "",
        totalAmount: 0,
        paymentId: null,
        error: null,
      },
      states: {
        pending: { on: { submit: { target: "processing" } } },
        processing: {
          entry: async (ctx, event: { orderId: string; amount: number }) => {
            const result: OrderContext = {
              ...ctx,
              orderId: event.orderId,
              totalAmount: event.amount,
            };
            return result;
          },
          onSuccess: { target: "awaiting_payment" },
          onError: { target: "failed" },
        },
        awaiting_payment: { on: { pay: { target: "charging" } } },
        charging: {
          entry: async (ctx, event: { paymentId: string }) => {
            // Simulate payment processing
            await new Promise((resolve) => setTimeout(resolve, 5));
            const result: OrderContext = { ...ctx, paymentId: event.paymentId };
            return result;
          },
          onSuccess: { target: "completed" },
          onError: { target: "payment_failed" },
        },
        completed: {},
        failed: { on: { retry: { target: "pending" } } },
        payment_failed: { on: { retry_payment: { target: "charging" } } },
      },
    });

    type OrderStates =
      | "pending"
      | "processing"
      | "awaiting_payment"
      | "charging"
      | "completed"
      | "failed"
      | "payment_failed";

    it("processes a successful order flow", async () => {
      const { adapter, savedSnapshots } = createMockAdapter<
        OrderContext,
        OrderStates
      >();

      const initialSnapshot: Snapshot<OrderContext, OrderStates> = {
        id: "order-1",
        state: "pending",
        context: { orderId: "", totalAmount: 0, paymentId: null, error: null },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let actor = createActorFromSnapshot(
        initialSnapshot,
        orderMachine,
        adapter,
      );

      // Submit order
      actor = await actor.send("submit", { orderId: "ORD-123", amount: 99.99 });
      expect(actor.state).toBe("awaiting_payment");
      expect(actor.context.orderId).toBe("ORD-123");
      expect(actor.context.totalAmount).toBe(99.99);

      // Process payment
      actor = await actor.send("pay", { paymentId: "PAY-456" });
      expect(actor.state).toBe("completed");
      expect(actor.context.paymentId).toBe("PAY-456");

      // Verify all state changes were persisted
      expect(savedSnapshots).toHaveLength(2);
      expect(savedSnapshots[0]?.state).toBe("awaiting_payment");
      expect(savedSnapshots[1]?.state).toBe("completed");
    });

    it("handles errors and recovery", async () => {
      // Machine with failing entry
      // Note: When entry throws, context is NOT updated (error happens before return)
      type AttemptsContext = { attempts: number };

      const failingOrderMachine = machine<AttemptsContext>().define({
        initial: "pending",
        context: { attempts: 0 },
        states: {
          pending: { on: { process: { target: "processing" } } },
          processing: {
            entry: (ctx, event: { shouldFail: boolean }) => {
              if (event.shouldFail) {
                throw new Error("Processing failed");
              }
              // Only increment on success
              const result: AttemptsContext = { attempts: ctx.attempts + 1 };
              return result;
            },
            onSuccess: { target: "completed" },
            onError: { target: "failed" },
          },
          completed: {},
          failed: { on: { retry: { target: "processing" } } },
        },
      });

      const { adapter } = createMockAdapter<
        AttemptsContext,
        "pending" | "processing" | "completed" | "failed"
      >();

      const initialSnapshot: Snapshot<
        AttemptsContext,
        "pending" | "processing" | "completed" | "failed"
      > = {
        id: "order-fail",
        state: "pending",
        context: { attempts: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let actor = createActorFromSnapshot(
        initialSnapshot,
        failingOrderMachine,
        adapter,
      );

      // First attempt fails - context is NOT updated because entry threw
      actor = await actor.send("process", { shouldFail: true });
      expect(actor.state).toBe("failed");
      expect(actor.context.attempts).toBe(0); // Unchanged because entry threw

      // Retry and succeed
      actor = await actor.send("retry", { shouldFail: false });
      expect(actor.state).toBe("completed");
      expect(actor.context.attempts).toBe(1); // Now incremented
    });
  });

  describe("Multi-step workflow", () => {
    type DocContext = {
      title: string;
      content: string;
      reviewedBy: string | null;
      approvedBy: string | null;
    };

    const documentWorkflow = machine<DocContext>().define({
      initial: "draft",
      context: {
        title: "",
        content: "",
        reviewedBy: null,
        approvedBy: null,
      },
      states: {
        draft: { on: { submit_for_review: { target: "submitting" } } },
        submitting: {
          entry: (ctx, event: { title: string; content: string }) => {
            const result: DocContext = {
              ...ctx,
              title: event.title,
              content: event.content,
            };
            return result;
          },
          onSuccess: { target: "in_review" },
        },
        in_review: {
          on: {
            approve: { target: "approving" },
            reject: { target: "rejected" },
          },
        },
        approving: {
          entry: (ctx, event: { reviewerId: string }) => {
            const result: DocContext = {
              ...ctx,
              reviewedBy: event.reviewerId,
            };
            return result;
          },
          onSuccess: { target: "approved" },
        },
        rejected: { on: { revise: { target: "draft" } } },
        approved: { on: { publish: { target: "publishing" } } },
        publishing: {
          entry: (ctx, event: { approverId: string }) => {
            const result: DocContext = {
              ...ctx,
              approvedBy: event.approverId,
            };
            return result;
          },
          onSuccess: { target: "published" },
        },
        published: {},
      },
    });

    type DocStates =
      | "draft"
      | "submitting"
      | "in_review"
      | "approving"
      | "rejected"
      | "approved"
      | "publishing"
      | "published";

    it("completes full approval workflow", async () => {
      const { adapter } = createMockAdapter<DocContext, DocStates>();

      const initialSnapshot: Snapshot<DocContext, DocStates> = {
        id: "doc-1",
        state: "draft",
        context: { title: "", content: "", reviewedBy: null, approvedBy: null },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let actor = createActorFromSnapshot(
        initialSnapshot,
        documentWorkflow,
        adapter,
      );

      // Submit for review
      actor = await actor.send("submit_for_review", {
        title: "Important Document",
        content: "Document content here...",
      });
      expect(actor.state).toBe("in_review");
      expect(actor.context.title).toBe("Important Document");

      // Approve review
      actor = await actor.send("approve", { reviewerId: "reviewer-1" });
      expect(actor.state).toBe("approved");
      expect(actor.context.reviewedBy).toBe("reviewer-1");

      // Publish
      actor = await actor.send("publish", { approverId: "approver-1" });
      expect(actor.state).toBe("published");
      expect(actor.context.approvedBy).toBe("approver-1");
    });

    it("handles rejection and revision", async () => {
      const { adapter } = createMockAdapter<DocContext, DocStates>();

      const initialSnapshot: Snapshot<DocContext, DocStates> = {
        id: "doc-2",
        state: "in_review",
        context: {
          title: "Draft Doc",
          content: "Needs work",
          reviewedBy: null,
          approvedBy: null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let actor = createActorFromSnapshot(
        initialSnapshot,
        documentWorkflow,
        adapter,
      );

      // Reject
      actor = await actor.send("reject");
      expect(actor.state).toBe("rejected");

      // Revise (back to draft)
      actor = await actor.send("revise");
      expect(actor.state).toBe("draft");

      // Submit again
      actor = await actor.send("submit_for_review", {
        title: "Revised Document",
        content: "Better content",
      });
      expect(actor.state).toBe("in_review");
      expect(actor.context.title).toBe("Revised Document");
    });
  });

  describe("Unhandled events", () => {
    const simpleMachine = machine<Record<string, never>>().define({
      initial: "a",
      context: {},
      states: {
        a: { on: { to_b: { target: "b" } } },
        b: { on: { to_a: { target: "a" } } },
      },
    });

    it("ignores unhandled events and returns same actor", async () => {
      const { adapter } = createMockAdapter<Record<string, never>, "a" | "b">();

      const initialSnapshot: Snapshot<Record<string, never>, "a" | "b"> = {
        id: "test-1",
        state: "a",
        context: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const actor = createActorFromSnapshot(
        initialSnapshot,
        simpleMachine,
        adapter,
      );

      // Send an event that's valid but not handled in current state
      const sameActor = await actor.send("to_a"); // "to_a" is only handled in state "b"

      expect(sameActor).toBe(actor); // Same instance (no-op)
      expect(sameActor.state).toBe("a");
      expect(adapter.save).not.toHaveBeenCalled();
    });
  });
});

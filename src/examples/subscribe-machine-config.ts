import { machine } from "@/machine.js";

type SubContext = { stripeCustomerId: string | null };

export const subscribeMachineConfig = machine<SubContext>().define({
  initial: "inactive",
  states: {
    inactive: {
      on: {
        activate: {
          target: "activating",
        },
      },
    },
    activating: {
      entry: async (ctx, event: { stripeCustomerId: string }) => {
        console.log(
          `   ⚙️  [Actor Entry] Activating subscription for customer: ${event.stripeCustomerId}`,
        );
        return {
          ...ctx,
          stripeCustomerId: event.stripeCustomerId,
        };
      },
      onSuccess: {
        target: "active",
      },
      onError: {
        target: "activation_failed",
      },
    },
    activation_failed: {
      on: {
        retry: {
          target: "activating",
        },
      },
    },
    active: {
      on: {
        deactivate: {
          target: "inactive",
        },
      },
    },
  },
  onActorError: ({ id, state, error }) => {
    console.error("Subscription actor entry failed", { id, state, error });
  },
});

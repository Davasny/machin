# machin

<p align="center">
TypeScript state machines with built-in persistence.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/machin"><img alt="npm" src="https://img.shields.io/npm/v/machin?style=flat-square" /></a>
  <a href="https://github.com/Davasny/machin/actions/workflows/release.yml">
    <img alt="Build" src="https://img.shields.io/github/actions/workflow/status/Davasny/machin/release.yml?style=flat-square" />
  </a>
  <img alt="License" src="https://img.shields.io/npm/l/machin?style=flat-square" />
</p>

---

State machines are great for modeling complex workflows. But persisting them usually means gluing together a state machine library, a database layer, and custom sync logic.

machin handles both. Define your machine, pick a storage adapter, and your state transitions are automatically persisted. No manual saves, no sync bugs.

## Features

- Awaitable by design
- Postgres, SQLite, and Redis adapters included
- Full TypeScript inference for states, events, and context
- Inspect sendable events with `actor.nextEvents`

## Installation

```bash
npm install machin
```

```bash
pnpm add machin
```

```bash
yarn add machin
```

## Quick example

```typescript
import { machine } from "machin";
import { withDrizzlePg } from "machin/drizzle/pg";

type Context = { customerId: string | null };

// Define your machine
const orderMachine = machine<Context>().define({
  initial: "pending",
  states: {
    pending: {
      on: { confirm: { target: "processing" } },
    },
    processing: {
      entry: async (ctx, event: { customerId: string }) => {
        // Do async work here
        return { ...ctx, customerId: event.customerId };
      },
      onSuccess: { target: "completed" },
      onError: { target: "failed" },
    },
    completed: {},
    failed: {
      on: { retry: { target: "processing" } },
    },
  },
});

// Bind to storage
const boundMachine = withDrizzlePg(orderMachine, { db, table: ordersTable });

// Create an actor and inspect what can be sent now
const actor = await boundMachine.createActor("order-123", { customerId: null });
console.log(actor.nextEvents); // ["confirm"]

// Actors are immutable, so keep the returned actor
const nextActor = await actor.send("confirm", { customerId: "customer-456" });

console.log(nextActor.state); // "completed"
console.log(nextActor.nextEvents); // []
```

State is persisted automatically after each transition.

## Inspecting next events

Each actor exposes `nextEvents`, which lists the event names available from its current state.

```typescript
const actor = await boundMachine.getActor("order-123");

if (actor) {
  console.log(actor.state);
  console.log(actor.nextEvents);
}
```

`nextEvents` returns names only. If an event targets a state with an `entry` payload, you still pass that payload when calling `send()`.

## Conditional transitions

Guards can be used in `on`, `onSuccess`, and `onError`. For entry states, `onSuccess`
guards run against the updated context returned by `entry`.

```typescript
import { machine } from "machin";

type OrderContext = {
  paymentStatus:
    | "pending"
    | "authorized"
    | "requires_manual_review"
    | "retryable_failure";
  attempts: number;
};

const orderMachine = machine<OrderContext>().define({
  initial: "awaiting_payment",
  states: {
    awaiting_payment: {
      on: {
        charge: [
          {
            guard: (ctx, payload) =>
              ctx.attempts < 3 && payload.amount > 0,
            target: "charging_card",
          },
          { target: "payment_failed" },
        ],
      },
    },
    charging_card: {
      entry: async (
        ctx,
        event: {
          amount: number;
          outcome: "authorized" | "requires_manual_review" | "retryable_failure";
        },
      ) => {
        return {
          ...ctx,
          attempts: ctx.attempts + 1,
          paymentStatus: event.outcome,
        };
      },
      onSuccess: [
        {
          guard: (ctx) => ctx.paymentStatus === "authorized",
          target: "paid",
        },
        {
          guard: (ctx) => ctx.paymentStatus === "requires_manual_review",
          target: "awaiting_manual_review",
        },
        {
          guard: (ctx) => ctx.paymentStatus === "retryable_failure",
          target: "payment_failed",
        },
      ],
      onError: { target: "payment_failed" },
    },
    awaiting_manual_review: {},
    paid: {},
    payment_failed: {},
  },
});
```

## Error handling

When an `entry` function throws, `onError` can transition to a failure state and
optionally update context with error details.

```typescript
import { machine } from "machin";

type PaymentContext = { result: string | null };

const paymentMachine = machine<PaymentContext>().define({
  initial: "pending",
  states: {
    pending: { on: { charge: { target: "charging" } } },
    charging: {
      entry: async (ctx, event: { amount: number }) => {
        return { ...ctx, result: await charge(event.amount) };
      },
      onSuccess: { target: "completed" },
      onError: {
        target: "charging_failed",
      },
    },
    completed: {},
    charging_failed: { on: { retry: { target: "charging" } } },
  },
  onActorError: ({ id, state, error, context }) => {
    logger.error({ id, state, error, context }, "Actor entry failed");
  },
});
```

When an `entry` fails and an `onError` branch matches, machin stores the thrown
message in the internal `errorMessage` snapshot field and persists it with the
new state.

Guarded `onError` arrays still choose the failure state. The library stores the
same error message regardless of which branch matches.

```typescript
onError: [
  {
    guard: (_ctx, error) => error instanceof RetryablePaymentError,
    target: "retryable_failure",
  },
  {
    target: "fatal_failure",
  },
]
```

Error handling semantics:

- `onActorError` fires once when an `entry` throws.
- `onActorError` receives a single payload object (`{ id, state, error, context }`)
  with the original context before persistence.
- Exceptions thrown by `onActorError` are ignored.
- `errorMessage` is set when a matching `onError` transition handles an error.
- `errorMessage` is cleared after a successful `entry` transition.
- Non-entry transitions preserve the existing `errorMessage`.

## Storage adapters

### Postgres

```typescript
import { withDrizzlePg } from "machin/drizzle/pg";

const machine = withDrizzlePg(machineConfig, { db, table: myTable });
```

### SQLite

```typescript
import { withDrizzleSQLite } from "machin/drizzle/sqlite";

const machine = withDrizzleSQLite(machineConfig, { db, table: myTable });
```

### Redis

```typescript
import { createClient } from "redis";
import { withRedis } from "machin/redis";

const client = await createClient({ url: "redis://localhost:6379" }).connect();
const machine = withRedis(machineConfig, { client });
```

## Table schema

Your table needs these columns:

- `id` (text, primary key)
- `state` (text)
- `errorMessage` (text, required; empty string means no current error)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

Plus any columns for your context fields.

## Type inference utilities

machin provides type inference utilities to extract types from your machine definitions. This is useful for typing database columns, API responses, or any other code that needs to work with machine states, events, or context.

```typescript
import { machine, InferStates, InferEvents, InferContext } from "machin";

const myMachine = machine<{ count: number }>().define({
  initial: "idle",
  states: {
    idle: { on: { start: { target: "running" } } },
    running: { on: { stop: { target: "idle" } } },
  },
});

// Infer types from the machine
type States = InferStates<typeof myMachine>;   // "idle" | "running"
type Events = InferEvents<typeof myMachine>;   // "start" | "stop"
type Context = InferContext<typeof myMachine>; // { count: number }
```

### Using with Drizzle schemas

The inference utilities are particularly useful for typing your database schema columns:

```typescript
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { InferStates } from "machin";
import { orderMachine } from "./order-machine";

// Infer the state type from your machine
type OrderState = InferStates<typeof orderMachine>;
// → "pending" | "processing" | "completed" | "failed"

export const ordersTable = pgTable("orders", {
  id: uuid().primaryKey(),
  state: text().$type<OrderState>().notNull(),
  errorMessage: text().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
});
```

This ensures your database schema stays in sync with your machine definition - if you add or remove states from your machine, TypeScript will catch any mismatches.

### Migrating to 2.0.0

`machin@2.0.0` adds the required internal `errorMessage` field. Existing
database tables need an `errorMessage`/`error_message` text column. Existing
snapshots should be backfilled with an empty string.

## License

MIT

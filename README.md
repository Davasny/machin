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

// Create an actor and send events
const actor = await boundMachine.createActor("order-123", { customerId: null });
await actor.send("confirm", { customerId: "customer-456" });

console.log(actor.state); // "completed"
```

State is persisted automatically after each transition.

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
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
});
```

This ensures your database schema stays in sync with your machine definition - if you add or remove states from your machine, TypeScript will catch any mismatches.

## License

MIT

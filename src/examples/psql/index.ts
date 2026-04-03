import { v7 as uuidv7 } from "uuid";
import { withDrizzlePg } from "@/adapters/drizzle/pg.js";
import { subscribeMachineConfig } from "../subscribe-machine-config.js";
import { db } from "./db.js";
import { subscriptionsTable } from "./schema.js";

const subscriptionMachine = withDrizzlePg(subscribeMachineConfig, {
  db,
  table: subscriptionsTable,
});

const subscriberId = uuidv7();

console.log("\n🚀 Starting PostgreSQL Subscription State Machine Example\n");
console.log("━".repeat(60));

console.log("\n📦 Creating actor...");
const actor = await subscriptionMachine.createActor(subscriberId, {
  stripeCustomerId: null,
});

console.log(`✅ Actor spawned successfully`);
console.log(`   └─ Current state: "${actor.state}"`);
console.log(`   └─ Next events: ${JSON.stringify(actor.nextEvents)}`);
console.log(`   └─ Actor ID: "${subscriberId}"\n`);

console.log("━".repeat(60));
console.log("\n📨 Sending 'activate' event to actor...");
console.log(`   └─ Payload: { stripeCustomerId: "cus_456" }`);

const activateResult = await actor.send("activate", {
  stripeCustomerId: "cus_456",
});

console.log(`\n✅ Event processed successfully`);
console.log(`   └─ Previous state: "${actor.state}"`);
console.log(`   └─ New state: "${activateResult.state}"`);
console.log(`   └─ Next events: ${JSON.stringify(activateResult.nextEvents)}`);
console.log(`   └─ Context updated with customer ID\n`);

console.log("━".repeat(60));
console.log("\n🔌 Closing database connection...");

await db.$client.end();
console.log("✅ Database connection closed\n");

import { v7 as uuidv7 } from "uuid";
import { withDrizzleSQLite } from "@/adapters/drizzle/sqlite.js";
import { subscribeMachineConfig } from "../subscribe-machine-config.js";
import { closeDb, db } from "./db.js";

import { subscriptionsTable } from "./schema.js";

const subscriptionMachine = withDrizzleSQLite(subscribeMachineConfig, {
  db,
  table: subscriptionsTable,
});

const subscriberId = uuidv7();

console.log("\n🚀 Starting SQLite Subscription State Machine Example\n");
console.log("━".repeat(60));

console.log("\n📦 Creating actor...");
const actor = await subscriptionMachine.createActor(subscriberId, {
  stripeCustomerId: null,
});

console.log(`✅ Actor spawned successfully`);
console.log(`   └─ Current state: "${actor.state}"`);
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
console.log(`   └─ Context updated with customer ID\n`);

console.log("━".repeat(60));
console.log("\n🔌 Closing database...");

closeDb();
console.log("✅ Database connection closed\n");

import { createClient } from "redis";
import { v7 as uuidv7 } from "uuid";
import { withRedis } from "@/adapters/redis/index.js";
import { subscribeMachineConfig } from "../subscribe-machine-config.js";

const client = await createClient({
  url: "redis://localhost:6379",
})
  .on("error", (err) => console.log("Redis Client Error", err))
  .connect();

const subscriptionMachine = withRedis(subscribeMachineConfig, {
  client,
});

const subscriberId = uuidv7();

console.log("\n🚀 Starting redis Subscription State Machine Example\n");
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

client.destroy();

console.log("✅ Database connection closed\n");

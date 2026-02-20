/**
 * Environment variables — inject secrets and config into the sandbox.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... ANTHROPIC_API_KEY=sk-... npx tsx examples/env-vars.ts
 */
import { Box, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
  runtime: "node",
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  env: {
    DATABASE_URL: "postgres://user:pass@db.example.com/mydb",
    API_SECRET: "sk_test_abc123",
    NODE_ENV: "production",
  },
});

console.log(`Box created: ${box.id}\n`);

// Verify env vars are available inside the sandbox
const result = await box.exec("echo $DATABASE_URL && echo $NODE_ENV");
console.log("Env vars inside sandbox:");
console.log(await result.result());

// Agent can use them too
const run = await box.agent.run({
  prompt: "Read the DATABASE_URL env var and create a db.ts config file that exports a connection pool",
  onStream: (chunk) => process.stdout.write(chunk),
});

console.log("\n\nGenerated file:");
console.log(await box.files.read("db.ts"));

await box.delete();

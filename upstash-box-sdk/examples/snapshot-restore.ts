/**
 * Snapshots — save workspace state and restore into a new box.
 * Great for checkpointing work or creating reusable environments.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... ANTHROPIC_API_KEY=sk-... npx tsx examples/snapshot-restore.ts
 */
import { Box, ClaudeCode } from "@buggyhunter/box";

const agentConfig = {
  model: ClaudeCode.Sonnet_4_5 as const,
  apiKey: process.env.ANTHROPIC_API_KEY!,
};

// Step 1: Create a box and set up a project
console.log("=== Step 1: Create and set up ===\n");
const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
  runtime: "node",
  agent: agentConfig,
});
console.log(`Box created: ${box.id}`);

await box.agent.run({
  prompt: "Create a simple Express REST API with GET /users and POST /users endpoints. Use TypeScript.",
  onStream: (chunk) => process.stdout.write(chunk),
});

// List what was created
const files = await box.files.list();
console.log(`\n\nFiles created: ${files.map((f) => f.name).join(", ")}`);

// Step 2: Save a snapshot
console.log("\n=== Step 2: Save snapshot ===\n");
const snapshot = await box.snapshot({ name: "api-v1" });
console.log(`Snapshot saved: ${snapshot.id} (${snapshot.status}, ${snapshot.size_bytes} bytes)`);

// Step 3: List all snapshots
const snapshots = await box.listSnapshots();
console.log(`Total snapshots: ${snapshots.length}`);

// Step 4: Restore into a new box
console.log("\n=== Step 3: Restore into new box ===\n");
const restored = await Box.fromSnapshot(snapshot.id, {
  apiKey: process.env.UPSTASH_BOX_API_KEY,
  agent: agentConfig,
});
console.log(`Restored box: ${restored.id}`);

// Verify files are there
const restoredFiles = await restored.files.list();
console.log(`Restored files: ${restoredFiles.map((f) => f.name).join(", ")}`);

// Continue building on the restored state
await restored.agent.run({
  prompt: "Add input validation with zod to the POST /users endpoint",
  onStream: (chunk) => process.stdout.write(chunk),
});

// Cleanup
console.log("\n\n=== Cleanup ===");
await box.deleteSnapshot(snapshot.id);
await box.delete();
await restored.delete();
console.log("Done.");

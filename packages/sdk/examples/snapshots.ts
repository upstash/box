import { Box, Runtime, ClaudeCode } from "@upstash/box";

const config = {
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.CLAUDE_KEY!,
  },
};

// Create a box and do some work
const box = await Box.create(config);

const run = await box.agent.run({
  prompt: "Create a hello.ts file that prints 'Hello, World!'",
});
console.log(run.result);

// Save the workspace as a snapshot
console.log("\nCreating snapshot...");
const snapshot = await box.snapshot({ name: "after-hello-world" });
console.log(`Snapshot created: ${snapshot.id}`);
console.log(`  Name: ${snapshot.name}`);
console.log(`  Status: ${snapshot.status}`);
console.log(`  Size: ${snapshot.size_bytes} bytes`);

// List all snapshots
const snapshots = await box.listSnapshots();
console.log(`\nSnapshots: ${snapshots.length}`);
for (const s of snapshots) {
  console.log(`  [${s.status}] ${s.name} — ${s.size_bytes} bytes`);
}

// Create a new box from the snapshot
console.log("\nCreating box from snapshot...");
const restoredBox = await Box.fromSnapshot(snapshot.id, config);
console.log(`Restored box: ${restoredBox.id}`);

// Verify the file exists in the restored box
const files = await restoredBox.files.list();
console.log(`Files in restored box:`);
for (const f of files) {
  console.log(`  ${f.name} (${f.size} bytes)`);
}

// Clean up: delete snapshot and both boxes
// await box.deleteSnapshot(snapshot.id);
// await restoredBox.delete();
// await box.delete();

console.log("\nDone!");

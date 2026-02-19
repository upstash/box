/**
 * History test — runs multiple prompts against a box to generate
 * many history entries (steps) with file changes.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... CLAUDE_KEY=sk-... npx tsx examples/history-test.ts
 */
import { Box, ClaudeCode, Runtime } from "@buggyhunter/box";

const PROMPTS = [
  "Create a file called /workspace/home/hello.ts with a function that returns 'Hello, World!'",
  "Create a file called /workspace/home/math.ts with add, subtract, multiply, divide functions",
  "Create a file called /workspace/home/utils.ts with a function that reverses a string and another that checks if a string is a palindrome",
  "Create /workspace/home/config.json with some example configuration for a web app (port, database url, etc)",
  "Create /workspace/home/index.ts that imports from hello.ts, math.ts and utils.ts and calls each function with example inputs, printing results",
  "Add JSDoc comments to all exported functions in /workspace/home/math.ts",
  "Add error handling to the divide function in /workspace/home/math.ts to throw on division by zero",
  "Create /workspace/home/test.ts with simple test cases for the math functions (just console.log assertions)",
];

async function main() {
  console.log("Creating box...");
  const box = await Box.create({
    apiKey: process.env.UPSTASH_BOX_API_KEY!,
    runtime: Runtime.Node,
    agent: {
      model: ClaudeCode.Sonnet_4_5,
      apiKey: process.env.CLAUDE_KEY!,
    },
  });
  console.log(`Box created: ${box.id}\n`);

  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    console.log(`\n--- Run ${i + 1}/${PROMPTS.length} ---`);
    console.log(`Prompt: ${prompt.slice(0, 80)}...`);

    try {
      const run = await box.agent.run({
        prompt,
        onStream: (chunk) => process.stdout.write(chunk),
      });

      const result = await run.result();
      const cost = await run.cost();
      console.log(`\nCompleted. Tokens: ${cost.tokens}, Cost: $${cost.totalUsd.toFixed(4)}`);
    } catch (err) {
      console.error(`\nRun ${i + 1} failed:`, err);
    }
  }

  // List files to see what was created
  console.log("\n\n--- Box 1: workspace files ---");
  try {
    const files = await box.files.list("/workspace/home");
    for (const f of files) {
      console.log(`  ${f.is_dir ? "d" : "-"} ${f.name} (${f.size} bytes)`);
    }
  } catch (err) {
    console.error("Failed to list files:", err);
  }

  // ==================== Snapshot ====================

  console.log("\n\n--- Taking snapshot ---");
  const snapshot = await box.snapshot({ name: "history-test-checkpoint" });
  console.log(`Snapshot created: ${snapshot.id} (${snapshot.size_bytes} bytes, status: ${snapshot.status})`);

  console.log(`\nBox 1 ID: ${box.id}`);

  // ==================== Restore into new box ====================

  console.log("\n--- Creating Box 2 from snapshot ---");
  const box2 = await Box.fromSnapshot(snapshot.id, {
    apiKey: process.env.UPSTASH_BOX_API_KEY!,
    runtime: Runtime.Node, // todo remove
    agent: { //
      model: ClaudeCode.Sonnet_4_5, //
      apiKey: process.env.CLAUDE_KEY!, //
    },
  });
  console.log(`Box 2 created: ${box2.id}`);

  // Verify old files exist
  console.log("\n--- Box 2: inherited files ---");
  try {
    const files = await box2.files.list("/workspace/home");
    for (const f of files) {
      console.log(`  ${f.is_dir ? "d" : "-"} ${f.name} (${f.size} bytes)`);
    }
  } catch (err) {
    console.error("Failed to list files:", err);
  }

  // Add new files on the restored box
  const SNAPSHOT_PROMPTS = [
    "Create /workspace/home/logger.ts with a simple Logger class that has info, warn, error methods and writes to console with timestamps",
    "Create /workspace/home/http.ts with a minimal HTTP client wrapper around fetch with get, post, put, delete methods that return typed JSON",
    "Update /workspace/home/index.ts to also import and demo logger.ts and http.ts",
  ];

  for (let i = 0; i < SNAPSHOT_PROMPTS.length; i++) {
    const prompt = SNAPSHOT_PROMPTS[i];
    console.log(`\n--- Box 2 Run ${i + 1}/${SNAPSHOT_PROMPTS.length} ---`);
    console.log(`Prompt: ${prompt.slice(0, 80)}...`);

    try {
      const run = await box2.agent.run({
        prompt,
        onStream: (chunk) => process.stdout.write(chunk),
      });

      await run.result();
      const cost = await run.cost();
      console.log(`\nCompleted. Tokens: ${cost.tokens}, Cost: $${cost.totalUsd.toFixed(4)}`);
    } catch (err) {
      console.error(`\nBox 2 Run ${i + 1} failed:`, err);
    }
  }

  // Final file listing
  console.log("\n\n--- Box 2: final files ---");
  try {
    const files = await box2.files.list("/workspace/home");
    for (const f of files) {
      console.log(`  ${f.is_dir ? "d" : "-"} ${f.name} (${f.size} bytes)`);
    }
  } catch (err) {
    console.error("Failed to list files:", err);
  }

  console.log(`\nBox 1: ${box.id}`);
  console.log(`Box 2: ${box2.id} (from snapshot ${snapshot.id})`);
  console.log("Both boxes still running — check History tab in the console UI.");
}

main().catch(console.error);

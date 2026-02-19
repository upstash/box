/**
 * Multiple runtimes — run the same task in Python, Node, and Go.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... ANTHROPIC_API_KEY=sk-... npx tsx examples/multi-runtime.ts
 */
import { Box, ClaudeCode } from "@upstash/box";

const runtimes = ["node", "python", "golang"] as const;
const prompt = "Write a program that generates the first 20 Fibonacci numbers and prints them. Use only the standard library.";

console.log("Creating boxes for each runtime...\n");

const boxes = await Promise.all(
  runtimes.map((runtime) =>
    Box.create({
      apiKey: process.env.UPSTASH_BOX_API_KEY,
      runtime,
      agent: {
        model: ClaudeCode.Sonnet_4_5,
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    }),
  ),
);

for (let i = 0; i < boxes.length; i++) {
  const runtime = runtimes[i];
  const box = boxes[i];

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Runtime: ${runtime} (box: ${box.id})`);
  console.log("=".repeat(40));

  const run = await box.agent.run({
    prompt,
    onStream: (chunk) => process.stdout.write(chunk),
  });

  const cost = await run.cost();
  console.log(`\nTokens: ${cost.tokens}, Cost: $${cost.totalUsd.toFixed(4)}`);

  // Show the created files
  const files = await box.files.list();
  console.log(`Files: ${files.filter((f) => !f.is_dir).map((f) => f.name).join(", ")}`);
}

// Cleanup
await Promise.all(boxes.map((box) => box.delete()));
console.log("\nAll boxes deleted.");

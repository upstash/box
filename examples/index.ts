import { Box, Runtime, ClaudeCode } from "../src/index.js";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: ClaudeCode.Sonnet_4,
    apiKey: process.env.CLAUDE_KEY!,
  },
});

console.log(`Created box: ${box.id}`);

// Run a prompt
const run = await box.run({
  prompt: "List all files in /work and describe what you see",
});

for await (const chunk of run.stream()) {
  process.stdout.write(chunk);
}

// Shell command
console.log("\n\n=== Shell ===");
const result = await box.shell("ls -la /work");
console.log(result.output);

// Status
const status = await box.getStatus();
console.log(`Status: ${status.status}`);

await box.delete();
console.log("Box deleted.");

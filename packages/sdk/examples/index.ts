import { Box, Runtime, ClaudeCode } from "@upstash/box";

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

// Single-shot run — await the result
const run = await box.agent.run({
  prompt: "List all files in the current directory and describe what you see",
});
const output = await run.result();
const cost = await run.cost();
console.log(output);
console.log(`Tokens: ${cost.tokens}`);

// Shell command
console.log("\n\n=== Shell ===");
const shell = await box.exec("ls -la");
const shellOutput = await shell.result();
console.log(shellOutput);

// Status
const status = await box.getStatus();
console.log(`Status: ${status.status}`);

await box.delete();
console.log("Box deleted.");

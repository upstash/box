import { Box, Runtime, ClaudeCode } from "@upstash/box";

// Test that conversation history persists across multiple prompts.

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.CLAUDE_KEY!,
  },
});

console.log(`Box: ${box.id}\n`);

// Prompt 1: Tell it a secret
console.log("=== Prompt 1: Telling it a secret ===");
const run1 = await box.agent.run({
  prompt: "Remember this: the secret code is PINEAPPLE-42. Don't write it to any file, just remember it.",
});
console.log(run1.result);

// Prompt 2: Ask it to recall
console.log("\n=== Prompt 2: Asking to recall ===");
const run2 = await box.agent.run({
  prompt: "What is the secret code I told you earlier?",
});
console.log(run2.result);

// Prompt 3: Ask what we talked about
console.log("\n=== Prompt 3: Asking about conversation history ===");
const run3 = await box.agent.run({
  prompt: "Summarize everything we've discussed so far in this conversation. List each prompt I gave you and what you responded.",
});
console.log(run3.result);

await box.delete();
console.log("\nDone. Box deleted.");

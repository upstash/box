import { Box, Runtime, OpenAICodex } from "@upstash/box";

// Use OpenAI Codex instead of Claude Code.
// The only difference is the model enum and the API key — everything else is identical.

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: OpenAICodex.GPT_5_2_Codex,
    apiKey: process.env.OPENAI_API_KEY!,
  },
  git: {
    token: process.env.GITHUB_TOKEN!,
  },
});

// Simple run — no repo needed
const run = await box.agent.run({
  prompt: `What is 2+2? Reply in one word.`,
});

console.log("OUTPUT:", JSON.stringify(await run.result()));
const cost = await run.cost();
console.log(`Tokens: ${cost.tokens} (${run._inputTokens} in / ${run._outputTokens} out)`);

// Streaming with async iterator
console.log("\n--- Streaming ---");
for await (const chunk of box.agent.stream({
  prompt: `List 3 programming languages. One per line.`,
})) {
  if (chunk.type === "text-delta") process.stdout.write(chunk.text);
}

// await box.delete();

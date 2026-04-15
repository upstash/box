/**
 * Tool use streaming — shows agent actions (file writes, commands, etc.)
 * alongside text output.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... ANTHROPIC_API_KEY=sk-... npx tsx examples/tool-use.ts
 */
import { Box, Agent } from "@upstash/box";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
  runtime: "node",
  agent: {
    harness: Agent.ClaudeCode,
    model: "anthropic/claude-sonnet-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});

console.log(`Box created: ${box.id}\n`);

const run = await box.agent.stream({
  prompt: "Create a CLI tool that converts CSV to JSON",
});
for await (const chunk of run) {
  if (chunk.type === "text-delta") process.stdout.write(chunk.text);
  if (chunk.type === "tool-call") {
    const input = JSON.stringify(chunk.input).slice(0, 120);
    console.log(`\n→ ${chunk.toolName}: ${input}`);
  }
  if (chunk.type === "finish") {
    console.log(`\nTokens: ${chunk.usage.inputTokens + chunk.usage.outputTokens}`);
  }
}

await box.delete();

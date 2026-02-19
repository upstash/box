/**
 * Tool use streaming — shows agent actions (file writes, commands, etc.)
 * alongside text output.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... ANTHROPIC_API_KEY=sk-... npx tsx examples/tool-use.ts
 */
import { Box, ClaudeCode } from "@buggyhunter/box";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
  runtime: "node",
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});

console.log(`Box created: ${box.id}\n`);

const run = await box.agent.run({
  prompt: "Create a CLI tool that converts CSV to JSON",
  onStream: (chunk) => process.stdout.write(chunk),
  onToolUse: (tool) => {
    const input = JSON.stringify(tool.input).slice(0, 120);
    console.log(`\n→ ${tool.name}: ${input}`);
  },
});

const cost = await run.cost();
console.log(`\nTokens: ${cost.tokens}, Cost: $${cost.totalUsd.toFixed(4)}`);

await box.delete();

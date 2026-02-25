import { Box, Runtime, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.CLAUDE_KEY!,
  },
});

// Run a prompt — the run is tracked on the backend
const run = await box.agent.run({
  prompt: "Create a hello.ts file that prints 'Hello, World!'",
});

// Run ID is assigned by the backend via the run_start SSE event
console.log(`\nRun ID: ${run.id}`);

// Status is fetched from the backend
const status = await run.status();
console.log(`Status: ${status}`);

// Cost includes real USD pricing from the backend
const cost = run.cost;
console.log(`Tokens: ${cost.inputTokens + cost.outputTokens}`);
console.log(`Duration: ${cost.computeMs}ms`);
console.log(`Cost: $${cost.totalUsd.toFixed(4)}`);

// List all runs for this box (newest first)
const runs = await box.listRuns();
console.log(`\nTotal runs: ${runs.length}`);
for (const r of runs) {
  console.log(`  [${r.status}] ${r.prompt?.slice(0, 50) ?? "—"} — $${(r.cost_usd ?? 0).toFixed(4)}`);
}

await box.delete();

/**
 * Webhook example — fire-and-forget runs that POST results to a URL on completion.
 *
 * This example starts a local HTTP server to receive the webhook, then fires
 * a box run with a webhook config. The run returns immediately and the backend
 * POSTs the result to your webhook URL when the agent is done.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... CLAUDE_KEY=sk-... npx tsx examples/webhook.ts
 */
import { createServer } from "node:http";
import { Box, Agent } from "@upstash/box";
import type { WebhookPayload } from "@upstash/box";

const WEBHOOK_PORT = 4567;

// ── 1. Start a local webhook receiver ────────────────────────────────────────

const received: WebhookPayload[] = [];

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/hook") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      console.log("\n========================================");
      console.log("Webhook received!");

      const payload = JSON.parse(body) as WebhookPayload;
      received.push(payload);

      console.log(`  Box ID:    ${payload.box_id}`);
      console.log(`  Status:    ${payload.status}`);
      console.log(`  Run ID:    ${payload.run_id}`);
      console.log(`  Output:    ${String(payload.output).slice(0, 200)}...`);
      if (payload.error) {
        console.log(`  Error:     ${payload.error}`);
      }
      console.log("========================================\n");

      res.writeHead(200);
      res.end("ok");

      // Shut down after receiving all webhooks
      if (received.length >= 2) {
        console.log("All webhooks received. Cleaning up...");
        server.close();
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(WEBHOOK_PORT, () => {
  console.log(`Webhook server listening on http://localhost:${WEBHOOK_PORT}/hook\n`);
});

// ── 2. Create a box and fire webhook runs ────────────────────────────────────

async function main() {
  const box = await Box.create({
    apiKey: process.env.UPSTASH_BOX_API_KEY!,
    runtime: "node",
    agent: {
      harness: Agent.ClaudeCode,
      model: "anthropic/claude-sonnet-4-5",
      apiKey: process.env.CLAUDE_KEY!,
    },
  });
  console.log(`Box created: ${box.id}\n`);

  // Fire-and-forget run #1
  console.log("Firing webhook run #1...");
  const run1 = await box.agent.run({
    prompt: "Create a file /workspace/home/greeting.ts that exports a greet(name: string) function",
    webhook: { url: `http://localhost:${WEBHOOK_PORT}/hook` },
  });
  console.log(`  Run #1 accepted (id: ${run1.id})`);

  // Fire-and-forget run #2
  console.log("Firing webhook run #2...");
  const run2 = await box.agent.run({
    prompt: "Create a file /workspace/home/counter.ts that exports an increment() and decrement() function with a shared counter",
    webhook: { url: `http://localhost:${WEBHOOK_PORT}/hook` },
  });
  console.log(`  Run #2 accepted (id: ${run2.id})`);

  console.log("\nWaiting for webhooks to arrive...");

  // Keep alive until webhooks arrive or timeout
  setTimeout(async () => {
    console.log("\nTimeout — cleaning up.");
    await box.delete();
    server.close();
    process.exit(0);
  }, 300_000);
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});

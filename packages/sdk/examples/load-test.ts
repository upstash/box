/**
 * Load test — opens 100 boxes in parallel, runs a prompt on each.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... CLAUDE_KEY=sk-... npx tsx examples/load-test.ts
 */
import { Box, ClaudeCode, Runtime } from "@upstash/box";

const BOX_COUNT = 100;
const CONCURRENCY = 10; // create in batches to avoid overwhelming the API

async function createAndRun(index: number): Promise<{ id: string; status: string; ms: number }> {
  const start = Date.now();
  try {
    const box = await Box.create({
      apiKey: process.env.UPSTASH_BOX_API_KEY!,
      runtime: Runtime.Node,
      agent: {
        model: ClaudeCode.Sonnet_4_5,
        apiKey: process.env.CLAUDE_KEY!,
      },
    });

    // const run = await box.agent.run({
    //   prompt: `Create a file /workspace/home/box-${index}.ts that exports a function called box${index}() which returns "I am box #${index}"`,
    // });
    // run.result;

    const ms = Date.now() - start;
    console.log(`  [${index + 1}/${BOX_COUNT}] ${box.id} — done (${(ms / 1000).toFixed(1)}s)`);
    return { id: box.id, status: "ok", ms };
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [${index + 1}/${BOX_COUNT}] FAILED — ${msg} (${(ms / 1000).toFixed(1)}s)`);
    return { id: "", status: msg, ms };
  }
}

async function main() {
  console.log(`Opening ${BOX_COUNT} boxes (concurrency: ${CONCURRENCY})...\n`);
  const allStart = Date.now();
  const results: { id: string; status: string; ms: number }[] = [];

  for (let batch = 0; batch < BOX_COUNT; batch += CONCURRENCY) {
    const size = Math.min(CONCURRENCY, BOX_COUNT - batch);
    console.log(`Batch ${Math.floor(batch / CONCURRENCY) + 1} (boxes ${batch + 1}-${batch + size}):`);

    const promises = Array.from({ length: size }, (_, i) => createAndRun(batch + i));
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  const totalMs = Date.now() - allStart;
  const succeeded = results.filter((r) => r.status === "ok");
  const failed = results.filter((r) => r.status !== "ok");

  console.log("\n========================================");
  console.log(`Total:     ${BOX_COUNT} boxes`);
  console.log(`Succeeded: ${succeeded.length}`);
  console.log(`Failed:    ${failed.length}`);
  console.log(`Time:      ${(totalMs / 1000).toFixed(1)}s`);

  if (succeeded.length > 0) {
    const avgMs = succeeded.reduce((s, r) => s + r.ms, 0) / succeeded.length;
    console.log(`Avg time:  ${(avgMs / 1000).toFixed(1)}s per box`);
  }

  console.log("\nBox IDs:");
  for (const r of succeeded) {
    console.log(`  ${r.id}`);
  }

  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const r of failed) {
      console.log(`  ${r.status}`);
    }
  }

  console.log("\nBoxes are NOT deleted — clean up manually when done.");
}

main().catch(console.error);

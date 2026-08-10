import { writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { z } from "zod/v3";

// Guide 1, example 3: productionize the agent run.
// The same task as example 1, instrumented: watch it live, record the
// session, inspect every decision, account for latency and tokens, and keep
// the evidence. Only the instrumentation is new.

const box = await Box.create({ runtime: "node", browser: true });

try {
  const tab = await box.browser.tab.create("https://books.toscrape.com", {
    waitUntil: "domcontentloaded",
  });

  // 1. Watch: open this URL in your browser to see the agent work (view-only).
  console.log("live view:", await tab.liveViewUrl());

  // 2. Record: capture the whole session as a replayable video.
  const recording = await box.browser.recordings.start({ maxDurationSeconds: 300 });

  const t0 = performance.now();
  let result;
  let finished;
  try {
    result = await tab.run(
      [
        "Find a science fiction book rated 5 stars priced under £30.",
        "If the Science Fiction category has no book meeting both constraints,",
        "try the Fantasy category instead.",
        "Report the book you chose, and for every category you rejected, why.",
      ].join(" "),
      {
        schema: z.object({
          title: z.string(),
          price: z.string(),
          rating: z.number().min(1).max(5),
          category: z.string(),
          rejected: z.array(z.object({ category: z.string(), reason: z.string() })),
        }),
        maxSteps: 25,
      },
    );
  } finally {
    // Stop the recording even if the run fails, so the video shows what went wrong.
    finished = await recording.stop();
  }
  const elapsedMs = Math.round(performance.now() - t0);

  if (!result.completed) {
    throw new Error(`agent did not finish within the step budget: ${result.result}`);
  }

  // 3. Inspect: every decision the agent made, with its reasoning.
  console.log("\ndecisions:");
  for (const step of result.steps) {
    const reasoning = "reasoning" in step ? String(step.reasoning).split("\n")[0].slice(0, 100) : "";
    console.log(`  ${step.step}. [${step.action}] ${reasoning}`);
  }

  // 4. Account: what this run cost.
  console.log(`\nlatency: ${(elapsedMs / 1000).toFixed(1)}s over ${result.stepCount} steps`);
  console.log(`tokens: ${result.inputTokens} in / ${result.outputTokens} out`);

  // 5. Evidence: typed result + session video, kept locally.
  await writeFile("hunt-result.json", JSON.stringify(result.data, null, 2));
  const video = await box.browser.recordings.download(finished.id, { path: "hunt-session.mp4" });
  console.log(`\nresult saved to hunt-result.json, session video to ${video}`);
} finally {
  await box.delete();
}

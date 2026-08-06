import { Box } from "@upstash/box";
import { z } from "zod/v3";

// Guide 1, example 1: constrained hunt with fallback.
// The path cannot be scripted upfront: the agent searches the category,
// concludes the constraint is unsatisfiable there, and switches to the
// fallback category on its own, explaining what it rejected and why.

const box = await Box.create({ runtime: "node", browser: true });

try {
  const tab = await box.browser.tab.create("https://books.toscrape.com", {
    waitUntil: "domcontentloaded",
  });

  const t0 = performance.now();
  const result = await tab.run(
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
      maxSteps: 25, // step budget: category + fallback fits well under this
    },
  );

  if (!result.completed) {
    throw new Error(`agent did not finish within the step budget: ${result.result}`);
  }

  const secs = ((performance.now() - t0) / 1000).toFixed(0);
  console.log("result:", JSON.stringify(result.data, null, 2));
  console.log(`\ncompleted in ${result.stepCount} steps (${secs}s)`);
  console.log(`tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  console.log("\nsteps taken:");
  for (const step of result.steps) console.log(" -", JSON.stringify(step).slice(0, 140));
} finally {
  await box.delete();
}

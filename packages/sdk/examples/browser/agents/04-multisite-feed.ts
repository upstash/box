import { Box } from "@upstash/box";
import { z } from "zod/v3";

// Guide 1, example 4: one semantic workflow across varied layouts.
// Build a normalized developer-news feed from three differently structured
// sites. The prompt and schema stay identical; the agent absorbs the layout
// differences. Sites still differ in auth, pagination, and semantics — this
// scales the reading pattern, it does not abolish scraping engineering.

const SITES = ["https://news.ycombinator.com", "https://lobste.rs", "https://dev.to"];

const PageStories = z.object({
  stories: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url(),
        engagement: z.number().nullable(),
      }),
    )
    .min(1)
    .max(3),
});

const box = await Box.create({ runtime: "node", browser: true });

try {
  const feed: { source: string; title: string; url: string; engagement: number | null }[] = [];
  const errors: { site: string; error: string }[] = [];
  let totalTokens = 0;
  const t0 = performance.now();

  for (const site of SITES) {
    try {
      const tab = await box.browser.tab.create(site, { waitUntil: "domcontentloaded" });
      const result = await tab.run(
        [
          "Collect the top three visible stories or posts on this page.",
          "For each, return its title, its full link URL, and its engagement",
          "(points, upvotes, or reactions) as a number, or null if none is shown.",
        ].join(" "),
        { schema: PageStories, maxSteps: 12 }, // one page of reading per site
      );
      await tab.close();
      if (!result.completed) throw new Error("agent did not finish within the step budget");
      totalTokens += result.inputTokens + result.outputTokens;
      const source = new URL(site).hostname;
      for (const story of result.data.stories) feed.push({ source, ...story });
      console.log(`${site}: ${result.data.stories.length} stories in ${result.stepCount} steps`);
    } catch (err) {
      // One site failing must not take down the feed.
      errors.push({ site, error: (err as Error).message.slice(0, 120) });
      console.log(`${site}: failed, continuing`);
    }
  }

  // The normalized feed lives in the box, ready for whatever consumes it next.
  await box.files.write({ path: "feed.json", content: JSON.stringify(feed, null, 2) });

  const secs = ((performance.now() - t0) / 1000).toFixed(0);
  console.log(`\nfeed (${feed.length} stories):`);
  for (const item of feed) {
    console.log(`  [${item.source}] ${item.title} — ${item.engagement ?? "n/a"}`);
  }
  if (errors.length) console.log("\nerrors:", JSON.stringify(errors));
  console.log(`\n${SITES.length - errors.length}/${SITES.length} sites, ${totalTokens} tokens, ${secs}s`);
} finally {
  await box.delete();
}

import { Box } from "@upstash/box";
import { chromium } from "playwright-core";
import { z } from "zod/v3";

// Guide 1, example 2: the autonomy ladder.
// The same task three ways: open the first book on the page and report its
// title and price. Know the clicks -> script. Know the action -> act. Know
// only the goal -> run. Each rung up buys more autonomy and gives up more
// deterministic control.

const URL = "https://books.toscrape.com";

const box = await Box.create({ runtime: "node", browser: true });

try {
  // Rung 1 — Playwright over CDP. Exact selectors, zero tokens, breaks on redesign.
  {
    const t0 = performance.now();
    const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
    try {
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = await ctx.newPage();
      await page.goto(URL, { waitUntil: "domcontentloaded" });
      await page.click(".product_pod h3 a");
      await page.waitForSelector(".product_main");
      const title = await page.$eval(".product_main h1", (h) => h.textContent);
      const price = await page.$eval(".product_main .price_color", (p) => p.textContent);
      await page.close();
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`rung 1 (playwright): ${title} at ${price} — ${secs}s, 0 tokens`);
    } finally {
      await browser.close();
    }
  }

  // Rung 2 — act + extract. Describe each step, let AI resolve the page.
  // Both calls are metered; extract does not report its own token count.
  {
    const t0 = performance.now();
    const tab = await box.browser.tab.create(URL, { waitUntil: "domcontentloaded" });
    const action = await tab.act("click the first book in the product grid");
    if (!action.success) throw new Error(`act failed: ${action.message}`);
    const data = await tab.extract(
      "extract this book's title and price",
      z.object({ title: z.string(), price: z.string() }),
    );
    await tab.close();
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(
      `rung 2 (act + extract): ${data.title} at ${data.price} — ${secs}s, ` +
        `${action.inputTokens + action.outputTokens} tokens for act, plus the extract call`,
    );
  }

  // Rung 3 — run. State the goal, the agent plans the steps itself.
  {
    const t0 = performance.now();
    const tab = await box.browser.tab.create(URL, { waitUntil: "domcontentloaded" });
    const result = await tab.run(
      "Open the first book listed on this page and report its title and price.",
      {
        schema: z.object({ title: z.string(), price: z.string() }),
        maxSteps: 10, // step budget: click + read needs only a few steps
      },
    );
    await tab.close();
    if (!result.completed) throw new Error(`agent did not finish: ${result.result}`);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(
      `rung 3 (run): ${result.data?.title} at ${result.data?.price} — ${secs}s, ` +
        `${result.stepCount} steps, ${result.inputTokens + result.outputTokens} tokens`,
    );
  }
} finally {
  await box.delete();
}

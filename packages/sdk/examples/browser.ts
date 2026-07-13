/**
 * box.browser — DOM-aware control of the box's Chromium via CDP.
 *
 * `box.browser` manages tabs; every page operation runs on a `Tab` handle.
 *
 * Run:
 *   UPSTASH_BOX_API_KEY=... UPSTASH_BOX_BASE_URL=... tsx examples/browser.ts
 */
import { Box } from "../src/index.js";
import { z } from "zod/v3"; // NOTE: zod/v3 (the SDK's schema converter targets v3)

const box = await Box.create({ runtime: "node", browser: true });
try {
  // Open a tab and navigate it (boots Chromium if it isn't running yet).
  const tab = await box.browser.newTab("https://github.com/upstash/ratelimit-js/pull/1");

  // Read the page via the real DOM.
  const page = await tab.content();
  console.log("page:", page.title);

  // Extract schema-validated structured data (Stagehand-style).
  const { author, title } = await tab.extract(
    "extract the author and title of the PR",
    z.object({
      author: z.string().describe("The username of the PR author"),
      title: z.string().describe("The title of the PR"),
    }),
  );
  console.log("extracted:", { author, title });

  // List actionable elements matching an instruction.
  const { elements } = await tab.observe("the primary action buttons");
  console.log(
    "observed:",
    elements.map((e) => e.description),
  );

  // Open a second tab, screenshot it, then list and close tabs.
  const search = await box.browser.newTab("https://html.duckduckgo.com/html/");
  const shot = await search.screenshot();
  console.log("screenshot bytes:", shot.length);

  const tabs = await box.browser.listTabs();
  console.log(
    "open tabs:",
    tabs.map((t) => t.id),
  );

  await search.close();
  await tab.close();
} finally {
  await box.delete();
}

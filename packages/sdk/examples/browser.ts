/**
 * box.browser — DOM-aware control of the desktop's Chromium via CDP.
 *
 * Run:
 *   UPSTASH_BOX_API_KEY=... UPSTASH_BOX_BASE_URL=... tsx examples/browser.ts
 */
import { Box } from "../src/index.js";
import { z } from "zod/v3"; // NOTE: zod/v3 (the SDK's schema converter targets v3)

const box = await Box.create({ runtime: "node", desktop: true });
try {
  await box.desktop.start(); // boot the desktop (Chromium available)

  // Navigate (launches Chromium if none is open) and read the page via the real DOM
  const page = await box.browser.goto("https://github.com/upstash/ratelimit-js/pull/1");
  console.log("page:", page.title);

  // Extract schema-validated structured data (Stagehand-style)
  const { author, title } = await box.browser.extract(
    "extract the author and title of the PR",
    z.object({
      author: z.string().describe("The username of the PR author"),
      title: z.string().describe("The title of the PR"),
    }),
  );
  console.log("extracted:", { author, title });

  // List actionable elements matching an instruction
  const { elements } = await box.browser.observe("the primary action buttons");
  console.log(
    "observed:",
    elements.map((e) => e.description),
  );
} finally {
  await box.delete();
}

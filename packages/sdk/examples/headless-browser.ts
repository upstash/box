/**
 * Headless browser (no desktop) — box.browser.* on a lightweight box.
 *
 * `browser: true` boots a Chromium (on a bare virtual display, no XFCE/noVNC),
 * so the whole box.browser.* surface works without ever starting a desktop.
 *
 * Run:
 *   UPSTASH_BOX_API_KEY=... UPSTASH_BOX_BASE_URL=... tsx examples/headless-browser.ts
 */
import { Box } from "../src/index.js";
import { z } from "zod/v3"; // NOTE: zod/v3
import { writeFileSync } from "node:fs";

const box = await Box.create({ runtime: "node", browser: true }); // headless — NO desktop
try {
  // Open a tab and navigate it (launches Chromium if none is open).
  const tab = await box.browser.newTab();
  const page = await tab.goto("https://upstash.com/pricing/redis");
  console.log("page:", page.title);

  // Read the DOM
  const { text, links } = await tab.content();
  console.log("content:", text.length, "chars,", links?.length, "links");

  // Extract schema-validated data
  const payg = await tab.extract(
    "Extract the Pay as you go price per 100K commands",
    z.object({ pricePer100kCommands: z.string() }),
  );
  console.log("extracted:", payg);

  // Screenshot via CDP (renders to memory — there is no screen)
  const png = await tab.screenshot();
  writeFileSync("/tmp/headless.png", png);
  console.log("screenshot:", png.length, "bytes -> /tmp/headless.png");
} finally {
  await box.delete();
}

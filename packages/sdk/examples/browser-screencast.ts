/**
 * tab.screencastUrl() — live view of a box browser tab.
 *
 * Returns a browser-openable, token-authenticated URL that renders the tab
 * live (CDP screencast). Open it directly or embed it in an iframe.
 * View-only: frames flow out, no input goes in.
 *
 * Run:
 *   UPSTASH_BOX_API_KEY=... UPSTASH_BOX_BASE_URL=... tsx examples/browser-screencast.ts
 */
import { Box } from "../src/index.js";

const box = await Box.create({ runtime: "node", browser: true });
try {
  const tab = await box.browser.newTab("https://example.com");

  const url = await tab.screencastUrl();
  console.log("watch live:", url);

  // Keep the box around for a minute so you can open the URL.
  await new Promise((r) => setTimeout(r, 60_000));

  await tab.close();
} finally {
  await box.delete();
}

/**
 * AI-driven browser search: open Google and search "upstash" using desktop.agent.act.
 *
 * Run:
 *   UPSTASH_BOX_API_KEY=... UPSTASH_BOX_BASE_URL=... tsx examples/desktop-ai-search.ts
 */
import { Box } from "../src/index.js";
import { writeFileSync } from "node:fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function save(name: string, shot?: string) {
  if (!shot) return;
  const path = `/tmp/${name}.png`;
  writeFileSync(path, Buffer.from(shot, "base64"));
  console.log(`  saved ${path}`);
}

async function main() {
  const box = await Box.create({ runtime: "node", desktop: true });
  console.log(`Box: ${box.id}`);

  try {
    // Larger viewport so Google's cookie-consent buttons are on-screen.
    await box.desktop.start({ width: 1920, height: 1080, open: "https://www.google.com" });
    const stream = await box.desktop.stream();
    console.log("Watch live:", stream.url);

    // Let Chromium load Google
    await sleep(15000);

    const shot = (await box.desktop.screenshot({ encoding: "base64" })) as string;
    save("search-0-google", shot);

    // Step 0 — AI dismisses the cookie consent dialog if present
    console.log('\nact: "Reject cookies to dismiss the consent dialog"');
    try {
      const c = await box.desktop.agent.act(
        'Click the "Reject all" button on the cookie consent dialog',
      );
      console.log("  actions:", JSON.stringify(c.actions));
      await sleep(3000);
    } catch {
      console.log("  (no consent dialog to dismiss)");
    }

    // Step 1 — AI clicks the search box
    console.log('\nact: "Click the Google search box"');
    let r = await box.desktop.agent.act(
      "Click the Google search input box in the center of the page",
    );
    console.log("  actions:", JSON.stringify(r.actions));
    save("search-1-clicked", r.screenshot);

    // Step 2 — type the query (deterministic + reliable)
    console.log('\ntype: "upstash"');
    await box.desktop.type("upstash");
    await box.desktop.press("enter");
    await sleep(6000);
    const results = (await box.desktop.screenshot({ encoding: "base64" })) as string;
    save("search-2-results", results);

    // Step 3 — AI clicks the first result
    console.log('\nact: "Click the first search result"');
    r = await box.desktop.agent.act(
      "Click the first organic search result link (the upstash.com website)",
    );
    console.log("  actions:", JSON.stringify(r.actions));
    await sleep(6000);
    const site = (await box.desktop.screenshot({ encoding: "base64" })) as string;
    save("search-3-site", site);

    console.log("\nDone. Screenshots in /tmp/search-*.png");
  } finally {
    await box.delete();
    console.log("Box deleted");
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

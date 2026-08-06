import { writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { chromium } from "playwright-core";

// Guide 2, example 4, script one: set up the authenticated workspace.
// Run this ONCE. It creates a keep-alive box, logs in, and prints the box id.
// The browser session then stays alive in the box — cookies, storage, open
// state — for any later script to reuse.
//
// keepAlive: true means the box never idles out. It keeps billing until you
// delete it, which is the point: the session is a durable asset. When the
// workspace is no longer needed: Box.get(id).delete(), then remove the id file.

const box = await Box.create({ runtime: "node", browser: true, keepAlive: true });

const tab = await box.browser.tab.create("https://www.saucedemo.com", {
  waitUntil: "domcontentloaded",
});

const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
try {
  const ctx = browser.contexts()[0];
  // Reuse the tab opened through the SDK above.
  const page = ctx.pages().find((p) => p.url().includes("saucedemo")) ?? ctx.pages()[0];
  await page.fill("#user-name", "standard_user");
  await page.fill("#password", "secret_sauce");
  await page.click("#login-button");
  await page.waitForSelector(".inventory_list");
} finally {
  await browser.close();
}

await writeFile(".box-workspace", box.id);
console.log(`workspace ready — box ${box.id} holds the authenticated session`);
console.log("watch it any time:", await tab.liveViewUrl());
console.log("run 04b-reuse-session.ts whenever you need the report");

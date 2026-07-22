/**
 * Drive a box's remote browser from your own automation framework.
 *
 * `browser.cdpUrl()` returns a `wss://…?token=…` endpoint that drops straight
 * into Playwright, Puppeteer, or Stagehand — no headers or credential wiring.
 *
 *   npm i playwright-core
 *   UPSTASH_BOX_API_KEY=... npx tsx examples/browser-connect.ts
 */
import { chromium } from "playwright-core";
import { Box } from "../src/index.js";

const box = await Box.create({ runtime: "node", browser: true });
console.log("box:", box.id);

try {
  // Open a tab in the box (also boots the browser if it isn't running yet).
  await box.browser.tab.create("https://example.com");

  const cdpUrl = await box.browser.cdpUrl();
  console.log("cdp url:", cdpUrl);

  // Playwright — hand the wss URL straight to connectOverCDP.
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  console.log("current page:", await page.title());
  await page.goto("https://www.iana.org/domains/reserved", { waitUntil: "domcontentloaded" });
  console.log("navigated to:", await page.title(), "-", page.url());

  await browser.close();

  // Stagehand — same URL, straight into localBrowserLaunchOptions.cdpUrl:
  //
  //   import { Stagehand } from "@browserbasehq/stagehand";
  //   const stagehand = new Stagehand({
  //     env: "LOCAL",
  //     localBrowserLaunchOptions: { cdpUrl },
  //   });
  //   await stagehand.init();
  //   await stagehand.act("click the first link");
} finally {
  await box.delete();
}

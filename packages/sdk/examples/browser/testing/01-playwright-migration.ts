import assert from "node:assert";
import { writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { chromium } from "playwright-core";

// Guide 4, example 1: migrate an existing Playwright test to a box.
// Your selectors, actions, and assertions usually remain unchanged; browser
// initialization connects to Box instead of launching locally. Suites that
// manage their own contexts, fixtures, or launch arguments may need small
// adjustments around lifecycle — the test bodies stay as they are.
//
//   // before — local browser:
//   const browser = await chromium.launch();
//
//   // after — the box's browser:
//   const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());

const box = await Box.create({ runtime: "node", browser: true });

try {
  await box.browser.tab.create("https://www.saucedemo.com", {
    waitUntil: "domcontentloaded",
  });

  // Record the run — more reliable than racing to open a live-view URL
  // before a fast test finishes.
  const recording = await box.browser.recordings.start({ maxDurationSeconds: 120 });

  const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
  try {
    const ctx = browser.contexts()[0];
    // Reuse the tab opened through the SDK above.
    const page = ctx.pages().find((p) => p.url().includes("saucedemo")) ?? ctx.pages()[0];

    // The test itself — unchanged from a local Playwright suite.
    try {
      await page.fill("#user-name", "standard_user");
      await page.fill("#password", "secret_sauce");
      await page.click("#login-button");
      await page.waitForSelector(".inventory_list");

      assert.ok(page.url().includes("/inventory.html"), "should land on inventory");
      const itemCount = await page.$$eval(".inventory_item", (items) => items.length);
      assert.strictEqual(itemCount, 6, "inventory should list 6 products");
      console.log("login flow test passed");
    } catch (err) {
      // On failure, keep the evidence next to the error.
      await writeFile("failure.png", await page.screenshot({ fullPage: true }));
      console.error("test failed — screenshot saved to failure.png");
      throw err;
    }
  } finally {
    await browser.close();
    const finished = await recording.stop();
    const video = await box.browser.recordings.download(finished.id, { path: "test-run.mp4" });
    console.log(`session video saved to ${video}`);
  }
} finally {
  await box.delete();
}

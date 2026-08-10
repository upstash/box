import { Box } from "@upstash/box";
import { chromium } from "playwright-core";

// Guide 2, example 1: hybrid checkout.
// Script what is deterministic, delegate what needs judgment. Playwright
// drives login, the checkout form, and the assertions with exact selectors
// (deterministic, though still redesign-sensitive). The one step that
// requires reading the page and deciding — picking the most expensive item —
// goes to act().

const box = await Box.create({ runtime: "node", browser: true });

try {
  const tab = await box.browser.tab.create("https://www.saucedemo.com", {
    waitUntil: "domcontentloaded",
  });

  const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
  try {
    const ctx = browser.contexts()[0];
    // Reuse the tab opened through the SDK above.
    const page = ctx.pages().find((p) => p.url().includes("saucedemo")) ?? ctx.pages()[0];

    // Deterministic: login, zero tokens.
    await page.fill("#user-name", "standard_user");
    await page.fill("#password", "secret_sauce");
    await page.click("#login-button");
    await page.waitForSelector(".inventory_list");

    // Ground truth for the later assertion: the actual maximum price on the page.
    const maxPrice = Math.max(
      ...(await page.$$eval(".inventory_item_price", (els) =>
        els.map((el) => Number(el.textContent!.replace("$", ""))),
      )),
    );

    // Judgment: the agent reads prices and decides. One metered call.
    const action = await tab.act("add the most expensive item on the page to the cart");
    if (!action.success) throw new Error(`act failed: ${action.message}`);
    console.log(`act: ${action.actionDescription}`);
    console.log(`act tokens: ${action.inputTokens} in / ${action.outputTokens} out`);

    // Deterministic again: checkout mechanics and the assertions.
    await page.click(".shopping_cart_link");
    await page.click("#checkout");
    await page.fill("#first-name", "Jane");
    await page.fill("#last-name", "Doe");
    await page.fill("#postal-code", "34000");
    await page.click("#continue");

    const itemName = await page.$eval(".inventory_item_name", (el) => el.textContent);
    const itemPrice = await page.$eval(".inventory_item_price", (el) =>
      Number(el.textContent!.replace("$", "")),
    );
    if (itemPrice !== maxPrice) {
      throw new Error(`agent picked $${itemPrice}, but the maximum on the page was $${maxPrice}`);
    }

    await page.click("#finish");
    const confirmation = await page.$eval(".complete-header", (el) => el.textContent);
    console.log(`ordered: ${itemName} at $${itemPrice} (verified maximum)`);
    console.log(`confirmation: ${confirmation}`);
  } finally {
    await browser.close();
  }
} finally {
  await box.delete();
}

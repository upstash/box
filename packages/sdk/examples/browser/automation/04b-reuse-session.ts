import { readFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { chromium } from "playwright-core";

// Guide 2, example 4, script two: pull a report from the workspace.
// Run this any time after 04a — a different process, hours later, or from
// your scheduler (cron, QStash). It reconnects to the box by id and works
// behind the login without ever re-authenticating.

// The workspace box stays active (and billing) between runs by design —
// see 04a for the cleanup step when you are done with it.
const boxId = process.argv[2] ?? (await readFile(".box-workspace", "utf8")).trim();
const box = await Box.get(boxId);

const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
try {
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  // No login step. If the session were gone, saucedemo would redirect here.
  await page.goto("https://www.saucedemo.com/inventory.html", {
    waitUntil: "domcontentloaded",
  });
  if (!page.url().includes("inventory")) {
    throw new Error("session expired — run 04a-login-once-keep-alive.ts again");
  }

  // The report: every product behind the login, as CSV.
  const items = await page.$$eval(".inventory_item", (cards) =>
    cards.map((card) => ({
      name: card.querySelector(".inventory_item_name")!.textContent!.trim(),
      price: card.querySelector(".inventory_item_price")!.textContent!.trim(),
    })),
  );
  await page.close();

  const csv = ["name,price", ...items.map((i) => `"${i.name}",${i.price}`)].join("\n");
  await box.files.write({ path: "inventory-report.csv", content: csv });

  console.log(`pulled ${items.length} products without logging in:`);
  for (const item of items.slice(0, 3)) console.log(`  ${item.name} — ${item.price}`);
  console.log("full report saved in the box as inventory-report.csv");
} finally {
  await browser.close();
}

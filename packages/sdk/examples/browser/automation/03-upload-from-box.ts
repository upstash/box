import { Box } from "@upstash/box";
import type { Page } from "playwright-core";
import { chromium } from "playwright-core";

// Guide 2, example 3: upload a file the box just created.
// Code generates the file on the box filesystem; the browser in the same box
// uploads it through a real form. The file never touches your machine.
//
// Why not page.setInputFiles()? Playwright transfers file *content* from the
// machine running the script. DOM.setFileInputFiles instead resolves a *path*
// on the machine running Chromium — the box — so box-generated files upload
// directly.

async function setRemoteInputFile(page: Page, selector: string, boxPath: string) {
  const session = await page.context().newCDPSession(page);
  const doc = await session.send("DOM.getDocument");
  const input = await session.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector,
  });
  if (!input.nodeId) throw new Error(`no element matches ${selector}`);
  await session.send("DOM.setFileInputFiles", { files: [boxPath], nodeId: input.nodeId });
}

const box = await Box.create({ runtime: "node", browser: true });

try {
  // Generate the file inside the box.
  const rows = ["id,name,plan", "1,acme,pro", "2,globex,free", "3,initech,pro"];
  await box.files.write({ path: "customers.csv", content: rows.join("\n") });

  await box.browser.tab.create("https://the-internet.herokuapp.com/upload", {
    waitUntil: "domcontentloaded",
  });

  const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
  try {
    const ctx = browser.contexts()[0];
    // Reuse the tab opened through the SDK above.
    const page = ctx.pages().find((p) => p.url().includes("the-internet")) ?? ctx.pages()[0];

    await setRemoteInputFile(page, "#file-upload", "/workspace/home/customers.csv");
    await page.click("#file-submit");

    // Assert the success page actually reports our file.
    await page.waitForSelector("#uploaded-files");
    const uploaded = await page.$eval("#uploaded-files", (el) => el.textContent?.trim());
    if (uploaded !== "customers.csv") throw new Error(`unexpected upload result: ${uploaded}`);
    console.log(`uploaded from the box: ${uploaded}`);
  } finally {
    await browser.close();
  }
} finally {
  await box.delete();
}

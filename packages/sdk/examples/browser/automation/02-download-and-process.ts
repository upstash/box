import { Box } from "@upstash/box";
import { chromium } from "playwright-core";

// Guide 2, example 2: download and process, without the file ever leaving.
// The browser's download lands on the box filesystem, code in the same box
// unpacks it and builds an inventory, and only the summary comes back.

const ZIP_URL = "https://codeload.github.com/upstash/qstash-js/zip/refs/heads/main";

const box = await Box.create({ runtime: "node", browser: true });

try {
  await box.browser.tab.create("about:blank");

  const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
  let fileName = "";
  try {
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    // Route downloads to the box workspace and watch for completion.
    const session = await browser.newBrowserCDPSession();
    await session.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: "/workspace/home",
      eventsEnabled: true,
    });
    const completed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("download timed out")), 60_000);
      session.on("Browser.downloadWillBegin", (e) => {
        fileName = e.suggestedFilename;
      });
      session.on("Browser.downloadProgress", (e) => {
        if (e.state === "completed") {
          clearTimeout(timer);
          resolve();
        }
        if (e.state === "canceled") {
          clearTimeout(timer);
          reject(new Error("download canceled"));
        }
      });
    });

    // The navigation becomes a download, which Playwright reports as a
    // failed navigation — only that specific error is expected here.
    await page.goto(ZIP_URL).catch((err) => {
      const msg = String(err.message);
      if (!msg.includes("Download is starting") && !msg.includes("ERR_ABORTED")) throw err;
    });
    await completed;
    console.log(`downloaded ${fileName} inside the box`);
  } finally {
    await browser.close();
  }

  // Process it in place: unpack and inventory the package. Only this JSON
  // summary leaves the box. The zip path arrives as an argument — never
  // interpolate values into generated source.
  const inventory = `
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const zip = process.argv[2];
execSync("unzip -o -q " + zip + " -d unpacked");

const root = "unpacked/" + readdirSync("unpacked")[0];
const pkg = JSON.parse(readFileSync(root + "/package.json", "utf8"));

const counts = { source: 0, test: 0 };
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".test.ts")) counts.test++;
    else if (entry.name.endsWith(".ts")) counts.source++;
  }
}
walk(root);

console.log(JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  sourceFiles: counts.source,
  testFiles: counts.test,
}));
`;
  await box.files.write({ path: "inventory.mjs", content: inventory });
  const run = await box.exec.command(`node inventory.mjs '${fileName}'`);
  if (run.exitCode !== 0) throw new Error(`inventory failed: ${run.stderr || run.stdout}`);
  console.log("inventory:", run.stdout.trim());
} finally {
  await box.delete();
}

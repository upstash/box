import { readFile, writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { chromium } from "playwright-core";

// Guide 4, example 4: visual regression with the box as the baseline store.
// Baselines persist on the box filesystem between runs, and comparison is a
// real pixel diff (pixelmatch, running inside the box): difference ratio,
// configurable threshold, and a generated diff image per changed route.
// Viewport and browser version are pinned by the box itself; animations are
// reduced and fonts awaited before capture. For routes with dynamic regions,
// mask them before screenshotting.
//
// The baseline box remains (and bills) between runs — that is what makes the
// baselines durable. Delete it to reset: Box.get(id).delete(), then remove
// the id file.

const ROUTES = [
  "https://books.toscrape.com/index.html",
  "https://books.toscrape.com/catalogue/category/books/travel_2/index.html",
  "https://books.toscrape.com/catalogue/category/books/mystery_3/index.html",
];
// Two different thresholds: PIXEL_THRESHOLD is pixelmatch's per-pixel color
// sensitivity (0-1; higher tolerates more anti-aliasing noise), while
// DIFF_THRESHOLD is the fraction of differing pixels above which a route
// counts as visually changed.
const PIXEL_THRESHOLD = 0.1;
const DIFF_THRESHOLD = 0.001;
const BOX_ID_FILE = ".box-visual-regression";

// Collision-resistant, filesystem-safe name for a route.
const routeName = (route: string) =>
  new URL(route).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";

const COMPARE = `
import fs from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const [aPath, bPath, outPath, pixelThreshold] = process.argv.slice(2);
const a = PNG.sync.read(fs.readFileSync(aPath));
const b = PNG.sync.read(fs.readFileSync(bPath));
if (a.width !== b.width || a.height !== b.height) {
  console.log(JSON.stringify({ diffRatio: 1, note: "dimension mismatch" }));
  process.exit(0);
}
const diff = new PNG({ width: a.width, height: a.height });
const differing = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
  threshold: Number(pixelThreshold),
});
fs.writeFileSync(outPath, PNG.sync.write(diff));
console.log(JSON.stringify({ diffRatio: differing / (a.width * a.height) }));
`;

let box: Box;
try {
  box = await Box.get((await readFile(BOX_ID_FILE, "utf8")).trim());
} catch {
  box = await Box.create({ runtime: "node", browser: true });
  await writeFile(BOX_ID_FILE, box.id);
  const setup = await box.exec.command(
    "npm install --no-fund --no-audit pixelmatch pngjs >/dev/null",
  );
  if (setup.exitCode !== 0) throw new Error(`setup failed: ${setup.stderr}`);
  await box.files.write({ path: "compare.mjs", content: COMPARE });
}

await box.browser.tab.create("about:blank");
const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());

const changed: { name: string; diffRatio: number }[] = [];
let createdBaselines = 0;
let compared = 0;

try {
  const ctx = browser.contexts()[0];
  // A fresh page each run: resumed boxes may hold stale pages from last time.
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const route of ROUTES) {
    const name = routeName(route);
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);

    const png = await page.screenshot({ fullPage: true, timeout: 45_000 });
    await box.files.write({
      path: `current/${name}.png`,
      content: png.toString("base64"),
      encoding: "base64",
    });

    const hasBaseline = (await box.exec.command(`test -f baselines/${name}.png`)).exitCode === 0;
    if (!hasBaseline) {
      await box.exec.command(`mkdir -p baselines && cp current/${name}.png baselines/${name}.png`);
      createdBaselines++;
      console.log(`baseline recorded: ${name}`);
      continue;
    }

    compared++;
    const cmp = await box.exec.command(
      `mkdir -p diffs && node compare.mjs baselines/${name}.png current/${name}.png diffs/${name}.png ${PIXEL_THRESHOLD}`,
    );
    if (cmp.exitCode !== 0) throw new Error(`compare failed for ${name}: ${cmp.stderr}`);
    const { diffRatio } = JSON.parse(cmp.stdout);

    if (diffRatio > DIFF_THRESHOLD) {
      changed.push({ name, diffRatio });
      for (const kind of ["baselines", "current", "diffs"]) {
        const img = await box.files.read(`${kind}/${name}.png`, { encoding: "base64" });
        await writeFile(`${name}.${kind}.png`, Buffer.from(img, "base64"));
      }
      console.log(`CHANGED: ${name} — ${(diffRatio * 100).toFixed(2)}% of pixels differ, images saved locally`);
    } else {
      console.log(`unchanged: ${name} (${(diffRatio * 100).toFixed(3)}% diff)`);
    }
  }
  await page.close();
} finally {
  await browser.close();
}

if (createdBaselines) {
  console.log(`\n${createdBaselines} baseline(s) recorded — run again to compare`);
}
if (compared) {
  if (changed.length) {
    console.log(`${changed.length}/${compared} compared routes changed visually`);
    process.exitCode = 1;
  } else {
    console.log(`all ${compared} compared routes match their baselines`);
  }
}

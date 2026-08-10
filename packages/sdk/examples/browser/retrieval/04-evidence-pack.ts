import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { chromium } from "playwright-core";

// Guide 3, example 4: the website evidence pack.
// For each URL: a full-page screenshot plus the metadata that makes it
// auditable — final URL after redirects, title, HTTP status, viewport,
// timestamp, and the image's SHA-256. One failed site never discards the
// others; failures are recorded in the manifest too. The archive is
// assembled in the box (capture bytes do pass through this process on the
// way in) and comes back as a single artifact.

const URLS = [
  "https://books.toscrape.com",
  "https://the-internet.herokuapp.com",
  "https://upstash.com/docs/qstash",
];

const box = await Box.create({ runtime: "node", browser: true });

try {
  await box.browser.tab.create("about:blank");
  const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());

  const manifest: Record<string, unknown>[] = [];
  try {
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    // Fixed viewport: captures are only comparable if the frame is pinned.
    await page.setViewportSize({ width: 1280, height: 720 });

    for (const url of URLS) {
      const name = `${new URL(url).hostname.replaceAll(".", "-")}.png`;
      try {
        // domcontentloaded + a bounded settle: networkidle hangs on sites
        // with long-polling analytics, so wait for load with a cap instead.
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(500);

        const png = await page.screenshot({ fullPage: true });
        await box.files.write({
          path: `evidence/${name}`,
          content: png.toString("base64"),
          encoding: "base64",
        });
        manifest.push({
          requestedUrl: url,
          finalUrl: page.url(),
          title: await page.title(),
          status: response?.status() ?? null,
          viewport: page.viewportSize(),
          capturedAt: new Date().toISOString(),
          screenshot: name,
          sha256: createHash("sha256").update(png).digest("hex"),
        });
        console.log(`captured ${url} -> ${name} (${png.byteLength} bytes)`);
      } catch (err) {
        manifest.push({
          requestedUrl: url,
          error: (err as Error).message.slice(0, 200),
          capturedAt: new Date().toISOString(),
        });
        console.log(`failed ${url}, recorded in manifest`);
      }
    }
  } finally {
    await browser.close();
  }

  // Assemble one auditable artifact inside the box, then bring it back.
  await box.files.write({
    path: "evidence/manifest.json",
    content: JSON.stringify(manifest, null, 2),
  });
  const pack = await box.exec.command("tar czf evidence-pack.tar.gz evidence");
  if (pack.exitCode !== 0) throw new Error(`packaging failed: ${pack.stderr}`);

  const archive = await box.files.read("evidence-pack.tar.gz", { encoding: "base64" });
  await writeFile("evidence-pack.tar.gz", Buffer.from(archive, "base64"));
  const ok = manifest.filter((m) => !("error" in m)).length;
  console.log(`\nevidence-pack.tar.gz downloaded (${ok}/${URLS.length} captures + manifest)`);
} finally {
  await box.delete();
}

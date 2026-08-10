import assert from "node:assert";
import { writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { chromium } from "playwright-core";

// Guide 4, example 2: test your own app inside the box.
// The box is a computer, so it can HOST the app under test and browse it on
// localhost — no deploy, no preview environment, no tunnel. Unmerged
// branches are testable the moment they compile.
//
// This demo writes a tiny app into the box so it runs as pasted. For a real
// project the setup block becomes:
//
//   await box.git.clone({ repo: "github.com/you/your-app" })
//   await box.exec.command("npm install")
//   await box.exec.command("nohup npm run dev > dev.log 2>&1 &")
//
// The server process needs no explicit cleanup: deleting the box ends it.

const APP = `
import { createServer } from "node:http";
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<h1 id='welcome'>Acme Dashboard</h1><nav><a href='/health'>health</a></nav>");
});
server.listen(3000, () => console.log("listening"));
`;

const box = await Box.create({ runtime: "node", browser: true });

try {
  // Start the app under test inside the box.
  await box.files.write({ path: "server.mjs", content: APP });
  const start = await box.exec.command("nohup node server.mjs > server.log 2>&1 &");
  if (start.exitCode !== 0) throw new Error(`app failed to start: ${start.stderr}`);

  // Bounded readiness check instead of a blind sleep.
  const HEALTH_CHECK = [
    "for i in $(seq 1 20); do",
    "  if curl -s -m 2 http://localhost:3000/health | grep -q ok; then echo ready; exit 0; fi;",
    "  sleep 0.5;",
    "done;",
    "cat server.log; exit 1",
  ].join(" ");
  const health = await box.exec.command(HEALTH_CHECK);
  if (health.exitCode !== 0 || !health.stdout.includes("ready")) {
    throw new Error(`app never became healthy: ${health.stdout} ${health.stderr}`);
  }

  // The box's browser reaches the app on ITS localhost.
  const tab = await box.browser.tab.create("http://localhost:3000", {
    waitUntil: "domcontentloaded",
  });

  const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
  try {
    const ctx = browser.contexts()[0];
    // Reuse the tab opened through the SDK above.
    const page = ctx.pages().find((p) => p.url().includes("localhost")) ?? ctx.pages()[0];

    const heading = await page.$eval("#welcome", (el) => el.textContent);
    assert.strictEqual(heading, "Acme Dashboard", "landing page should render");

    await page.click("nav a");
    const body = await page.textContent("body");
    assert.ok(body?.includes('"ok":true'), "health route should respond");
  } finally {
    await browser.close();
  }

  // Visible proof: what the box's browser saw.
  await tab.goto("http://localhost:3000");
  await writeFile("app-under-test.png", await tab.screenshot());
  console.log("app tested inside the box: landing page + health route pass");
  console.log("screenshot of the app saved to app-under-test.png");
} finally {
  await box.delete();
}

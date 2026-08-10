import assert from "node:assert";
import { Box } from "@upstash/box";
import { chromium } from "playwright-core";
import { z } from "zod/v3";

// Guide 4, example 3: natural-language smoke tests.
// Not a replacement for your E2E suite — selector-free smoke coverage that
// survives redesigns. The agent walks the flow and returns a typed verdict,
// but the verdict is NOT taken on faith: deterministic DOM assertions verify
// the end state independently, and the whole run is recorded so a failure
// comes with a video.

const box = await Box.create({ runtime: "node", browser: true });

try {
  const tab = await box.browser.tab.create("https://www.saucedemo.com", {
    waitUntil: "domcontentloaded",
  });
  const recording = await box.browser.recordings.start({ maxDurationSeconds: 300 });

  let result;
  try {
    result = await tab.run(
      [
        "Smoke-test this store: log in as standard_user with password",
        "secret_sauce, add the first product to the cart, open the cart,",
        "and go to checkout. For each step report whether it worked.",
        "Do not submit the checkout form.",
      ].join(" "),
      {
        schema: z.object({
          passed: z.boolean(),
          checks: z.array(z.object({ step: z.string(), ok: z.boolean(), note: z.string() })),
        }),
        maxSteps: 20, // step budget: four-step flow with headroom for retries
      },
    );
  } finally {
    const finished = await recording.stop();
    await box.browser.recordings.download(finished.id, { path: "smoke-run.mp4" });
  }

  if (!result.completed) throw new Error("smoke test did not finish within the step budget");

  for (const check of result.data.checks) {
    console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.step} — ${check.note}`);
  }
  console.log(`${result.stepCount} steps, ${result.inputTokens} in / ${result.outputTokens} out tokens`);

  // 1. The agent's own report must be coherent...
  assert.ok(result.data.checks.length >= 4, "expected at least 4 checks");
  assert.ok(result.data.checks.every((c) => c.ok), "a step reported failure");
  assert.strictEqual(result.data.passed, true, "verdict inconsistent with checks");

  // 2. ...and the end state must hold up to independent DOM assertions.
  const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
  try {
    const ctx = browser.contexts()[0];
    // Reuse the tab the agent drove, so we assert the state it left behind.
    const page = ctx.pages().find((p) => p.url().includes("saucedemo")) ?? ctx.pages()[0];
    assert.ok(page.url().includes("checkout-step-one"), `not on checkout: ${page.url()}`);
    const cartCount = await page.$eval(".shopping_cart_badge", (el) => el.textContent);
    assert.strictEqual(cartCount, "1", "cart should hold exactly one item");
  } finally {
    await browser.close();
  }

  console.log("smoke test passed — agent verdict confirmed by DOM assertions");
  console.log("session video saved to smoke-run.mp4");
} finally {
  await box.delete();
}

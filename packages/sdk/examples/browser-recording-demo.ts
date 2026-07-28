/**
 * Records a browser session that opens upstash.com and navigates to Customers.
 *
 * The box is kept after a successful run so the recording can be inspected.
 * Set DELETE_BOX=1 to delete it automatically instead.
 */
import { Agent, Box, BoxApiKey, OpenAICodex } from "../src/index.js";

const box = await Box.create({
  name: `browser-recording-demo-${Date.now()}`,
  runtime: "node",
  browser: true,
  agent: {
    harness: Agent.Codex,
    model: OpenAICodex.GPT_5_4,
    apiKey: BoxApiKey.UpstashKey,
  },
});

let completed = false;

try {
  // Chromium needs one tab before recording can start.
  const tab = await box.browser.tab.create("about:blank");
  const recording = await box.browser.recordings.start({ maxDurationSeconds: 120 });

  try {
    await tab.goto("https://upstash.com");

    const customersAction = await tab.act('click the "Customers" link in the site navigation');
    if (!customersAction.success) {
      throw new Error(`Could not open Customers: ${customersAction.message}`);
    }

    const page = await tab.content();
    if (!page.url.includes("upstash.com/customers")) {
      throw new Error(`Expected the Customers page, got ${page.url}`);
    }

    const firstScrollAction = await tab.act("scroll down to browse the customer stories");
    if (!firstScrollAction.success) {
      throw new Error(`Could not scroll through Customers: ${firstScrollAction.message}`);
    }

    const secondScrollAction = await tab.act("scroll further down to browse more customer stories");
    if (!secondScrollAction.success) {
      throw new Error(
        `Could not continue scrolling through Customers: ${secondScrollAction.message}`,
      );
    }

    const saved = await recording.stop();
    completed = true;

    console.log(
      JSON.stringify(
        {
          boxId: box.id,
          finalUrl: page.url,
          actions: [
            customersAction.actionDescription,
            firstScrollAction.actionDescription,
            secondScrollAction.actionDescription,
          ],
          recordingId: saved.id,
          recordingStatus: saved.status,
          durationMs: saved.durationMs,
          playlistUrl: saved.playlistUrl,
        },
        null,
        2,
      ),
    );
  } finally {
    if (!completed) {
      await recording.stop().catch(() => undefined);
    }
  }
} catch (error) {
  await box.delete().catch(() => undefined);
  throw error;
}

if (process.env.DELETE_BOX === "1") {
  await box.delete();
} else {
  console.log(`Box ${box.id} was kept so you can inspect the recording.`);
}

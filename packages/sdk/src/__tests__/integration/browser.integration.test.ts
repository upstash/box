import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent, Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("browser", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
      browser: true,
    });
  }, 180000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("opens a tab, reads content, screenshots, and closes it", async () => {
    const tab = await box.browser.tab.create("https://example.com");
    expect(tab.id).toBeTruthy();

    const content = await tab.content();
    expect(content.url).toContain("example.com");
    expect(content.text.toLowerCase()).toContain("example");

    const png = await tab.screenshot();
    // PNG magic bytes
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const tabs = await box.browser.listTabs();
    expect(tabs.some((t) => t.id === tab.id)).toBe(true);

    await tab.close();
  }, 180000);

  it("returns authenticated CDP and live-view URLs", async () => {
    const tab = await box.browser.tab.create("https://example.com");

    const cdpUrl = await box.browser.cdpUrl();
    expect(cdpUrl).toMatch(/^wss:\/\//);
    expect(cdpUrl).toContain("token=");

    const liveViewUrl = await tab.liveViewUrl();
    expect(liveViewUrl).toMatch(/^https:\/\//);
    expect(liveViewUrl).toContain("token=");

    await tab.close();
  }, 180000);
});

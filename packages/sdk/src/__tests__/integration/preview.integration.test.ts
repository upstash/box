import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent, Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

const SERVER_SECRET = "box-preview-integration-test-secret-42";

describe.skipIf(!UPSTASH_BOX_API_KEY)("preview", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Opus_4_6 },
    });

    // Start a simple HTTP server on port 3000 that responds with our secret
    await box.exec.command(
      `nohup node -e "require('http').createServer((_, res) => { res.end('${SERVER_SECRET}'); }).listen(3000)" > /dev/null 2>&1 &`,
    );
    // Give the server a moment to start
    await new Promise((r) => setTimeout(r, 1000));
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("getPreviewUrl: creates a public preview URL", async () => {
    const preview = await box.getPreviewUrl(3000);

    expect(preview.url).toBeTruthy();
    expect(preview.port).toBe(3000);
    expect(preview.token).toBeUndefined();
    expect(preview.username).toBeUndefined();
    expect(preview.password).toBeUndefined();

    // Cleanup
    await box.deletePreview(3000);
  });

  it("getPreviewUrl: creates a preview URL with bearer token and serves traffic", async () => {
    const preview = await box.getPreviewUrl(3000, { bearerToken: true });

    expect(preview.url).toBeTruthy();
    expect(preview.port).toBe(3000);
    expect(preview.token).toBeTruthy();

    // Request without token should be rejected
    const unauthorized = await fetch(preview.url);
    expect(unauthorized.ok).toBe(false);

    // Request with bearer token should succeed
    const authorized = await fetch(preview.url, {
      headers: { Authorization: `Bearer ${preview.token}` },
    });
    expect(authorized.ok).toBe(true);
    const body = await authorized.text();
    expect(body).toBe(SERVER_SECRET);

    // Cleanup
    await box.deletePreview(3000);
  });

  it("getPreviewUrl: creates a preview URL with basic auth", async () => {
    const preview = await box.getPreviewUrl(3000, { basicAuth: true });

    expect(preview.url).toBeTruthy();
    expect(preview.port).toBe(3000);
    expect(preview.username).toBeTruthy();
    expect(preview.password).toBeTruthy();

    // Cleanup
    await box.deletePreview(3000);
  });

  it("listPreviews: lists all preview URLs", async () => {
    await box.getPreviewUrl(3000);

    const res = await box.listPreviews();

    expect(res.previews.length).toBeGreaterThanOrEqual(1);
    expect(res.previews.some((p) => p.port === 3000)).toBe(true);

    // Cleanup
    await box.deletePreview(3000);
  });

  it("deletePreview: removes a preview URL", async () => {
    await box.getPreviewUrl(3000);
    await box.deletePreview(3000);

    const res = await box.listPreviews();
    expect(res.previews.every((p) => p.port !== 3000)).toBe(true);
  });
});

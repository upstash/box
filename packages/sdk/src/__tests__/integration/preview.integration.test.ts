import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent, Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

const SERVER_SECRET = "box-preview-integration-test-secret-42";

describe.skipIf(!UPSTASH_BOX_API_KEY)("public URLs", () => {
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

  it("getPublicURL: creates a public URL", async () => {
    const publicUrl = await box.getPublicURL(3000);

    expect(publicUrl.url).toBeTruthy();
    expect(publicUrl.port).toBe(3000);
    expect(publicUrl.token).toBeUndefined();
    expect(publicUrl.username).toBeUndefined();
    expect(publicUrl.password).toBeUndefined();

    // Cleanup
    await box.deletePublicURL(3000);
  });

  it("getPublicURL: creates a public URL with bearer token and serves traffic", async () => {
    const publicUrl = await box.getPublicURL(3000, { bearerToken: true });

    expect(publicUrl.url).toBeTruthy();
    expect(publicUrl.port).toBe(3000);
    expect(publicUrl.token).toBeTruthy();

    // Request without token should be rejected
    const unauthorized = await fetch(publicUrl.url);
    expect(unauthorized.ok).toBe(false);

    // Request with bearer token should succeed
    const authorized = await fetch(publicUrl.url, {
      headers: { Authorization: `Bearer ${publicUrl.token}` },
    });
    expect(authorized.ok).toBe(true);
    const body = await authorized.text();
    expect(body).toBe(SERVER_SECRET);

    // Cleanup
    await box.deletePublicURL(3000);
  });

  it("getPublicURL: creates a public URL with basic auth", async () => {
    const publicUrl = await box.getPublicURL(3000, { basicAuth: true });

    expect(publicUrl.url).toBeTruthy();
    expect(publicUrl.port).toBe(3000);
    expect(publicUrl.username).toBeTruthy();
    expect(publicUrl.password).toBeTruthy();

    // Cleanup
    await box.deletePublicURL(3000);
  });

  it("listPublicURLs: lists all public URLs", async () => {
    await box.getPublicURL(3000);

    const res = await box.listPublicURLs();

    expect(res.publicURLs.length).toBeGreaterThanOrEqual(1);
    expect(res.publicURLs.some((p) => p.port === 3000)).toBe(true);

    // Cleanup
    await box.deletePublicURL(3000);
  });

  it("deletePublicURL: removes a public URL", async () => {
    await box.getPublicURL(3000);
    await box.deletePublicURL(3000);

    const res = await box.listPublicURLs();
    expect(res.publicURLs.every((p) => p.port !== 3000)).toBe(true);
  });
});

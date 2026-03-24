import { describe, it, expect, afterAll } from "vitest";
import { WebSocket } from "ws";
import { Box, EphemeralBox, Agent, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

const REQUEST_CATCHER_HOST = "box-hidden-header-test.requestcatcher.com";
const REQUEST_CATCHER_URL = `https://${REQUEST_CATCHER_HOST}/test`;
const REQUEST_CATCHER_WS = `wss://${REQUEST_CATCHER_HOST}/init-client`;

interface CaughtRequest {
  headers: Record<string, string[]>;
  path: string;
  method: string;
  body: string;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Opens a WebSocket to request catcher and returns the first
 * caught request whose body contains the given marker.
 */
function waitForRequest(marker: string, timeout = 30_000): Promise<CaughtRequest> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(REQUEST_CATCHER_WS);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for request with marker "${marker}"`));
    }, timeout);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as CaughtRequest;

      if (msg.body?.includes(marker)) {
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Sends a curl from inside the box to request catcher and verifies
 * that the expected headers were injected by the proxy.
 */
async function assertHeaders(box: Box | EphemeralBox, expected: Record<string, string>) {
  const marker = `marker-${randomId()}-${Date.now()}`;
  const listener = waitForRequest(marker);

  // sleep a bit to ensure the WebSocket connection is established before sending the request
  await new Promise((res) => setTimeout(res, 1000));

  const run = await box.exec.command(`curl -s -X POST -d '${marker}' ${REQUEST_CATCHER_URL}`);
  expect(run.exitCode).toBe(0);

  const caught = await listener;

  expect(caught.path).toBe("/test");
  expect(caught.method).toBe("POST");
  expect(caught.body).toBe(marker);
  for (const [name, value] of Object.entries(expected)) {
    expect(caught.headers[name]?.[0]).toBe(value);
  }
}

describe.skipIf(!UPSTASH_BOX_API_KEY)("attachHeaders", () => {
  let box: Box;
  let boxFromSnap: Box;
  let boxSnapshotId: string;
  let ephemeral: EphemeralBox;
  let ephemeralFromSnap: EphemeralBox;
  let ephSnapshotId: string;

  // Source box headers: Authorization + X-Custom-Tag
  const srcAuthValue = `Bearer src-key-${randomId()}`;
  const srcTagValue = `src-tag-${randomId()}`;

  // fromSnapshot overrides Authorization, keeps X-Custom-Tag, adds X-New-Header
  const overriddenAuthValue = `Bearer overridden-key-${randomId()}`;
  const newHeaderValue = `new-header-${randomId()}`;

  const sourceConfig = {
    [REQUEST_CATCHER_HOST]: {
      Authorization: srcAuthValue,
      "X-Custom-Tag": srcTagValue,
    },
  };

  const fromSnapConfig = {
    [REQUEST_CATCHER_HOST]: {
      Authorization: overriddenAuthValue, // override
      "X-Custom-Tag": srcTagValue, // retained (same value)
      "X-New-Header": newHeaderValue, // new
    },
  };

  afterAll(async () => {
    const cleanup = [
      ephemeralFromSnap?.delete(),
      ephSnapshotId && ephemeral?.deleteSnapshot(ephSnapshotId),
      ephemeral?.delete(),
      boxFromSnap?.delete(),
      boxSnapshotId && box?.deleteSnapshot(boxSnapshotId),
      box?.delete(),
    ];
    await Promise.allSettled(cleanup.filter(Boolean));
  }, 30_000);

  // ── Box.create ──

  it("Box.create: creates a box with attachHeaders", async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_6 },
      attachHeaders: sourceConfig,
    });
    expect(box.id).toBeTruthy();
  }, 120_000);

  it("Box.create: injects headers into outbound requests", async () => {
    await assertHeaders(box, {
      Authorization: srcAuthValue,
      "X-Custom-Tag": srcTagValue,
    });
  }, 30_000);

  // ── Box.fromSnapshot ──

  it("Box.fromSnapshot: snapshots the source box", async () => {
    const snap = await box.snapshot({ name: "attach-headers-snap" });
    expect(snap.status).toBe("ready");
    boxSnapshotId = snap.id;
  }, 120_000);

  it("Box.fromSnapshot: restores with modified attachHeaders", async () => {
    boxFromSnap = await Box.fromSnapshot(boxSnapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_6 },
      attachHeaders: fromSnapConfig,
    });
    expect(boxFromSnap.id).toBeTruthy();
  }, 120_000);

  it("Box.fromSnapshot: retained header still present", async () => {
    await assertHeaders(boxFromSnap, { "X-Custom-Tag": srcTagValue });
  }, 30_000);

  it("Box.fromSnapshot: overridden header has new value", async () => {
    await assertHeaders(boxFromSnap, { Authorization: overriddenAuthValue });
  }, 30_000);

  it("Box.fromSnapshot: new header is injected", async () => {
    await assertHeaders(boxFromSnap, { "X-New-Header": newHeaderValue });
  }, 30_000);

  // ── EphemeralBox.create ──

  it("EphemeralBox.create: creates an ephemeral box with attachHeaders", async () => {
    ephemeral = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
      attachHeaders: sourceConfig,
    });
    expect(ephemeral.id).toBeTruthy();
  }, 30_000);

  it("EphemeralBox.create: injects headers into outbound requests", async () => {
    await assertHeaders(ephemeral, {
      Authorization: srcAuthValue,
      "X-Custom-Tag": srcTagValue,
    });
  }, 30_000);

  // ── EphemeralBox.fromSnapshot ──

  it("EphemeralBox.fromSnapshot: snapshots the source ephemeral box", async () => {
    const snap = await ephemeral.snapshot({ name: "attach-headers-eph-snap" });
    expect(snap.status).toBe("ready");
    ephSnapshotId = snap.id;
  }, 120_000);

  it("EphemeralBox.fromSnapshot: restores with modified attachHeaders", async () => {
    ephemeralFromSnap = await EphemeralBox.fromSnapshot(ephSnapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
      attachHeaders: fromSnapConfig,
    });
    expect(ephemeralFromSnap.id).toBeTruthy();
  }, 120_000);

  it("EphemeralBox.fromSnapshot: retained header still present", async () => {
    await assertHeaders(ephemeralFromSnap, { "X-Custom-Tag": srcTagValue });
  }, 30_000);

  it("EphemeralBox.fromSnapshot: overridden header has new value", async () => {
    await assertHeaders(ephemeralFromSnap, { Authorization: overriddenAuthValue });
  }, 30_000);

  it("EphemeralBox.fromSnapshot: new header is injected", async () => {
    await assertHeaders(ephemeralFromSnap, { "X-New-Header": newHeaderValue });
  }, 30_000);
});

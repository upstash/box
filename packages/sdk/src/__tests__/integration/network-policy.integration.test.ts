import { describe, it, expect, afterAll } from "vitest";
import { Box, EphemeralBox } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.create — default networkPolicy", () => {
  let box: Box | undefined;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("defaults to allow-all when networkPolicy is not specified", async () => {
    box = await Box.create({ apiKey: UPSTASH_BOX_API_KEY! });

    expect(box.networkPolicy).toEqual({ mode: "allow-all" });
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.create — networkPolicy", () => {
  let box: Box | undefined;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("creates a box with deny-all network policy", async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      networkPolicy: { mode: "deny-all" },
    });

    expect(box.id).toBeTruthy();
    expect(box.networkPolicy).toEqual({ mode: "deny-all" });

    // Outbound request should fail under deny-all
    const run = await box.exec.command("curl -s --max-time 5 https://example.com");
    expect(run.exitCode).toBe(35);
    expect(run.result).toBe("");
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.create — custom networkPolicy", () => {
  let box: Box | undefined;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("creates a box with custom network policy allowing a specific domain", async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      networkPolicy: {
        mode: "custom",
        allowedDomains: ["mock.httpstatus.io"],
      },
    });

    expect(box.id).toBeTruthy();
    expect(box.networkPolicy).toEqual({
      mode: "custom",
      allowedDomains: ["mock.httpstatus.io"],
    });

    // Allowed domain should succeed
    const allowed = await box.exec.command("curl -s --max-time 10 https://mock.httpstatus.io/200");
    expect(allowed.exitCode).toBe(0);

    // Non-allowed domain should fail
    const denied = await box.exec.command("curl -s --max-time 5 https://httpbin.org/get");
    expect(denied.exitCode).toBe(35);
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("box.updateNetworkPolicy", () => {
  let box: Box | undefined;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("updates from allow-all to deny-all and back, checking field each time", async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      networkPolicy: { mode: "allow-all" },
    });

    expect(box.networkPolicy).toEqual({ mode: "allow-all" });

    // Should work under allow-all
    const before = await box.exec.command("curl -s --max-time 10 https://mock.httpstatus.io/200");
    expect(before.exitCode).toBe(0);

    // Switch to deny-all
    await box.updateNetworkPolicy({ mode: "deny-all" });
    expect(box.networkPolicy).toEqual({ mode: "deny-all" });

    const denied = await box.exec.command("curl -s --max-time 5 https://example.com");
    expect(denied.exitCode).toBe(35);

    // Switch back to allow-all
    await box.updateNetworkPolicy({ mode: "allow-all" });
    expect(box.networkPolicy).toEqual({ mode: "allow-all" });

    const after = await box.exec.command("curl -s --max-time 10 https://mock.httpstatus.io/200");
    expect(after.exitCode).toBe(0);
  }, 180000);

  it("reconnected box reflects server network policy", async () => {
    // box was set to allow-all in the previous test
    const reconnected = await Box.get(box!.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(reconnected.networkPolicy).toEqual({ mode: "allow-all" });
  });
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.fromSnapshot — networkPolicy", () => {
  let sourceBox: Box | undefined;
  let restoredBox: Box | undefined;
  let snapshotId: string;

  afterAll(async () => {
    try {
      await restoredBox?.delete();
    } catch {
      // cleanup best-effort
    }
    try {
      if (snapshotId) await sourceBox?.deleteSnapshot(snapshotId);
    } catch {
      // cleanup best-effort
    }
    try {
      await sourceBox?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("fromSnapshot with deny-all network policy blocks outbound", async () => {
    sourceBox = await Box.create({ apiKey: UPSTASH_BOX_API_KEY! });

    const snap = await sourceBox.snapshot({ name: "net-policy-snap" });
    snapshotId = snap.id;

    restoredBox = await Box.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      networkPolicy: { mode: "deny-all" },
    });

    expect(restoredBox.networkPolicy).toEqual({ mode: "deny-all" });

    const run = await restoredBox.exec.command("curl -s --max-time 5 https://example.com");
    expect(run.exitCode).toBe(35);
  }, 240000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("EphemeralBox.fromSnapshot — networkPolicy", () => {
  let sourceBox: EphemeralBox | undefined;
  let restoredBox: EphemeralBox | undefined;
  let snapshotId: string;

  afterAll(async () => {
    try {
      await restoredBox?.delete();
    } catch {
      // cleanup best-effort
    }
    try {
      if (snapshotId) await sourceBox?.deleteSnapshot(snapshotId);
    } catch {
      // cleanup best-effort
    }
    try {
      await sourceBox?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("fromSnapshot ephemeral with deny-all network policy blocks outbound", async () => {
    sourceBox = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
    });

    const snap = await sourceBox.snapshot({ name: "eph-net-policy-snap" });
    snapshotId = snap.id;

    restoredBox = await EphemeralBox.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
      networkPolicy: { mode: "deny-all" },
    });

    expect(restoredBox.id).toBeTruthy();

    expect(restoredBox.networkPolicy).toEqual({ mode: "deny-all" });
    const run = await restoredBox.exec.command("curl -s --max-time 5 https://example.com");
    expect(run.exitCode).toBe(35);
  }, 240000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("EphemeralBox.create — networkPolicy", () => {
  let box: EphemeralBox | undefined;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("creates an ephemeral box with deny-all network policy", async () => {
    box = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
      networkPolicy: { mode: "deny-all" },
    });

    expect(box.id).toBeTruthy();

    const run = await box.exec.command("curl -s --max-time 5 https://example.com");
    expect(run.exitCode).toBe(35);
  }, 30000);
});

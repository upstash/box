import { describe, it, expect, afterAll } from "vitest";
import { Box, EphemeralBox } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.create — name", () => {
  let box: Box | undefined;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("create with name, then get by name returns the same box", async () => {
    const name = `test-box-${Date.now()}`;

    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      name,
    });

    const fetched = await Box.getByName(name, { apiKey: UPSTASH_BOX_API_KEY! });

    expect(fetched.id).toBe(box.id);
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.fromSnapshot — name", () => {
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

  it("fromSnapshot with name, then get by name returns the same box", async () => {
    sourceBox = await Box.create({ apiKey: UPSTASH_BOX_API_KEY! });

    const snap = await sourceBox.snapshot({ name: "name-test-snap" });
    snapshotId = snap.id;

    const name = `test-snap-box-${Date.now()}`;
    restoredBox = await Box.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      name,
    });

    const fetched = await Box.getByName(name, { apiKey: UPSTASH_BOX_API_KEY! });

    expect(fetched.id).toBe(restoredBox.id);
  }, 240000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("EphemeralBox.create — name", () => {
  let box: EphemeralBox | undefined;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("create ephemeral with name, then get by name returns the same box", async () => {
    const name = `test-ephemeral-${Date.now()}`;

    box = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      name,
      ttl: 300,
    });

    const fetched = await EphemeralBox.getByName(name, { apiKey: UPSTASH_BOX_API_KEY! });

    expect(fetched.id).toBe(box.id);
  }, 30000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("EphemeralBox.fromSnapshot — name", () => {
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

  it("fromSnapshot ephemeral with name, then get by name returns the same box", async () => {
    sourceBox = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
    });

    const snap = await sourceBox.snapshot({ name: "eph-name-test-snap" });
    snapshotId = snap.id;

    const name = `test-eph-snap-${Date.now()}`;
    restoredBox = await EphemeralBox.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      name,
      ttl: 300,
    });

    const fetched = await EphemeralBox.getByName(name, { apiKey: UPSTASH_BOX_API_KEY! });

    expect(fetched.id).toBe(restoredBox.id);
  }, 240000);
});

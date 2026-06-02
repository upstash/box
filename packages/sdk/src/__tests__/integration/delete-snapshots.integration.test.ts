import { describe, it, expect, afterAll } from "vitest";
import { Box, EphemeralBox } from "../../index.js";
import { UPSTASH_BOX_API_KEY, UPSTASH_BOX_BASE_URL } from "./setup.js";

const conn = { apiKey: UPSTASH_BOX_API_KEY!, baseUrl: UPSTASH_BOX_BASE_URL };

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.deleteSnapshots (static)", () => {
  let box: EphemeralBox | undefined;

  afterAll(async () => {
    try {
      await Box.deleteSnapshots(conn);
    } catch {}
    try {
      await box?.delete();
    } catch {}
  }, 30000);

  it("deletes a specific snapshot by ID", async () => {
    box = await EphemeralBox.create({ ...conn, ttl: 300 });
    const snap = await box.snapshot({ name: "integ-delete-single" });

    const r1 = await Box.deleteSnapshots({ ...conn, snapshotIds: snap.id });
    expect(r1.deleted).toBe(1);

    const remaining = await box.listSnapshots();
    expect(remaining.find((s) => s.id === snap.id)).toBeUndefined();
  }, 120000);

  it("deletes multiple snapshots by ID", async () => {
    box ??= await EphemeralBox.create({ ...conn, ttl: 300 });
    const [s1, s2] = await Promise.all([
      box.snapshot({ name: "integ-delete-multi-1" }),
      box.snapshot({ name: "integ-delete-multi-2" }),
    ]);

    const r2 = await Box.deleteSnapshots({ ...conn, snapshotIds: [s1.id, s2.id] });
    expect(r2.deleted).toBe(2);

    const remaining = await box.listSnapshots();
    expect(remaining.find((s) => s.id === s1.id)).toBeUndefined();
    expect(remaining.find((s) => s.id === s2.id)).toBeUndefined();
  }, 120000);

  it("deletes all snapshots when no snapshotIds provided", async () => {
    box ??= await EphemeralBox.create({ ...conn, ttl: 300 });
    await Promise.all([
      box.snapshot({ name: "integ-delete-all-1" }),
      box.snapshot({ name: "integ-delete-all-2" }),
    ]);

    const r3 = await Box.deleteSnapshots(conn);
    expect(r3.deleted).toBeGreaterThanOrEqual(2);

    const remaining = await box.listSnapshots();
    expect(remaining).toHaveLength(0);
  }, 120000);
});

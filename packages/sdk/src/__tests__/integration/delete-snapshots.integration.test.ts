import { describe, it, expect, afterAll } from "vitest";
import { Box, EphemeralBox } from "../../index.js";
import { ALLOW_ACCOUNT_WIDE_TESTS, UPSTASH_BOX_API_KEY, UPSTASH_BOX_BASE_URL } from "./setup.js";

const conn = { apiKey: UPSTASH_BOX_API_KEY!, baseUrl: UPSTASH_BOX_BASE_URL };

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.deleteSnapshots (static)", () => {
  let box: EphemeralBox | undefined;
  // Vitest runs test files in parallel and nine other files depend on their own
  // snapshots surviving, so this one only ever deletes ids it created.
  const created: string[] = [];

  afterAll(async () => {
    if (created.length > 0) {
      try {
        await Box.deleteSnapshots({ ...conn, snapshotIds: created });
      } catch {
        // cleanup best-effort
      }
    }
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  const snapshot = async (name: string) => {
    box ??= await EphemeralBox.create({ ...conn, ttl: 300 });
    const snap = await box.snapshot({ name });
    created.push(snap.id);
    return snap;
  };

  it("deletes a specific snapshot by ID", async () => {
    const snap = await snapshot("integ-delete-single");

    const r1 = await Box.deleteSnapshots({ ...conn, snapshotIds: snap.id });
    expect(r1.deleted).toBe(1);

    const remaining = await box!.listSnapshots();
    expect(remaining.find((s) => s.id === snap.id)).toBeUndefined();
  }, 120000);

  it("deletes multiple snapshots by ID", async () => {
    const [s1, s2] = await Promise.all([
      snapshot("integ-delete-multi-1"),
      snapshot("integ-delete-multi-2"),
    ]);

    const r2 = await Box.deleteSnapshots({ ...conn, snapshotIds: [s1.id, s2.id] });
    expect(r2.deleted).toBe(2);

    const remaining = await box!.listSnapshots();
    expect(remaining.find((s) => s.id === s1.id)).toBeUndefined();
    expect(remaining.find((s) => s.id === s2.id)).toBeUndefined();
  }, 120000);

  it("rejects an empty id list rather than deleting everything", async () => {
    await expect(Box.deleteSnapshots({ ...conn, snapshotIds: [] })).rejects.toThrow();
  });
});

// Deleting every snapshot on the account cannot share a key with anything else,
// including a second CI run on another pull request, so it is opt-in. The
// request shape for this call is covered by box-delete-snapshots.test.ts.
describe.skipIf(!UPSTASH_BOX_API_KEY || !ALLOW_ACCOUNT_WIDE_TESTS)(
  "Box.deleteSnapshots (account-wide)",
  () => {
    it("deletes all snapshots when no snapshotIds are provided", async () => {
      const box = await EphemeralBox.create({ ...conn, ttl: 300 });
      try {
        await Promise.all([
          box.snapshot({ name: "integ-delete-all-1" }),
          box.snapshot({ name: "integ-delete-all-2" }),
        ]);

        const result = await Box.deleteSnapshots(conn);
        expect(result.deleted).toBeGreaterThanOrEqual(2);
        expect(await box.listSnapshots()).toHaveLength(0);
      } finally {
        await box.delete().catch(() => {});
      }
    }, 120000);
  },
);

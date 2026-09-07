import { describe, it, expect, afterAll } from "vitest";
import { Box, EphemeralBox, ClaudeCode, Agent } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("EphemeralBox.fromSnapshot — from regular Box", () => {
  let sourceBox: Box;
  let ephemeralBox: EphemeralBox;
  let snapshotId: string;

  afterAll(async () => {
    try {
      await ephemeralBox?.delete();
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

  it("creates a source box and writes files", async () => {
    sourceBox = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { runner: Agent.ClaudeCode, model: ClaudeCode.Haiku_4_5 },
    });

    await sourceBox.files.write({ path: "hello.txt", content: "hello from snapshot" });
    await sourceBox.files.write({ path: "data/config.json", content: '{"key":"value"}' });

    const content = await sourceBox.files.read("hello.txt");
    expect(content).toBe("hello from snapshot");
  }, 120000);

  it("takes a snapshot of the source box", async () => {
    const snap = await sourceBox.snapshot({ name: "ephemeral-from-snap-test" });
    expect(snap.id).toBeTruthy();
    expect(snap.status).toBe("ready");
    snapshotId = snap.id;
  }, 120000);

  it("creates an ephemeral box from the snapshot", async () => {
    ephemeralBox = await EphemeralBox.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
    });

    expect(ephemeralBox.id).toBeTruthy();
    expect(ephemeralBox.expiresAt).toBeGreaterThan(0);
    expect(ephemeralBox.id).not.toBe(sourceBox.id);
  }, 120000);

  it("snapshot files exist in the ephemeral box", async () => {
    const hello = await ephemeralBox.files.read("hello.txt");
    expect(hello).toBe("hello from snapshot");

    const config = await ephemeralBox.files.read("data/config.json");
    expect(config).toBe('{"key":"value"}');
  });

  it("can list files from the snapshot", async () => {
    const files = await ephemeralBox.files.list();
    const names = files.map((f) => f.name);
    expect(names).toContain("hello.txt");
    expect(names).toContain("data");
  });

  it("can exec commands in the snapshot-based ephemeral box", async () => {
    const run = await ephemeralBox.exec.command("cat hello.txt");
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("hello from snapshot");
  });
});

describe.skipIf(!UPSTASH_BOX_API_KEY)(
  "EphemeralBox.fromSnapshot — from ephemeral Box snapshot",
  () => {
    let sourceBox: EphemeralBox;
    let restoredBox: EphemeralBox;
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

    it("creates an ephemeral box and writes files", async () => {
      sourceBox = await EphemeralBox.create({
        apiKey: UPSTASH_BOX_API_KEY!,
        runtime: "node",
        ttl: 300,
      });

      await sourceBox.files.write({ path: "ephemeral.txt", content: "ephemeral origin" });
      await sourceBox.files.write({ path: "nested/data.json", content: '{"from":"ephemeral"}' });

      const content = await sourceBox.files.read("ephemeral.txt");
      expect(content).toBe("ephemeral origin");
    }, 120000);

    it("takes a snapshot of the ephemeral box", async () => {
      const snap = await sourceBox.snapshot({ name: "ephemeral-to-ephemeral-test" });
      expect(snap.id).toBeTruthy();
      expect(snap.status).toBe("ready");
      snapshotId = snap.id;
    }, 120000);

    it("lists the snapshot", async () => {
      const snapshots = await sourceBox.listSnapshots();
      expect(snapshots.some((s) => s.id === snapshotId)).toBe(true);
    });

    it("creates a new ephemeral box from the ephemeral snapshot", async () => {
      restoredBox = await EphemeralBox.fromSnapshot(snapshotId, {
        apiKey: UPSTASH_BOX_API_KEY!,
        ttl: 300,
      });

      expect(restoredBox.id).toBeTruthy();
      expect(restoredBox.expiresAt).toBeGreaterThan(0);
      expect(restoredBox.id).not.toBe(sourceBox.id);
    }, 120000);

    it("snapshot files exist in the restored ephemeral box", async () => {
      const txt = await restoredBox.files.read("ephemeral.txt");
      expect(txt).toBe("ephemeral origin");

      const json = await restoredBox.files.read("nested/data.json");
      expect(json).toBe('{"from":"ephemeral"}');
    });

    it("can list files from the restored box", async () => {
      const files = await restoredBox.files.list();
      const names = files.map((f) => f.name);
      expect(names).toContain("ephemeral.txt");
      expect(names).toContain("nested");
    });

    it("can write new files in the restored box", async () => {
      await restoredBox.files.write({ path: "new-file.txt", content: "written after restore" });
      const content = await restoredBox.files.read("new-file.txt");
      expect(content).toBe("written after restore");
    });
  },
);

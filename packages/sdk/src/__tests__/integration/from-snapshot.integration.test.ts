import { describe, it, expect, afterAll } from "vitest";
import { Box } from "../../index.js";
import { UPSTASH_BOX_API_KEY, claudeAgent } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.fromSnapshot — agent", () => {
  let sourceBox: Box | undefined;
  let restoredBox: Box | undefined;
  let snapshotId: string;
  const randomContent = `snapshot-test-${crypto.randomUUID()}`;

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

  it("creates a source box with agent, writes a file, snapshots, restores, and agent reads the file", async () => {
    // Create source box with an agent
    sourceBox = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: claudeAgent(),
    });

    // Write a file with random content using exec
    const write = await sourceBox.exec.command(`echo -n '${randomContent}' > test-file.txt`);
    expect(write.exitCode).toBe(0);

    // Take a snapshot
    const snap = await sourceBox.snapshot({ name: "agent-snapshot-test" });
    expect(snap.id).toBeTruthy();
    snapshotId = snap.id;

    // Restore from snapshot. A direct agent key is not stored in the snapshot,
    // so pass the agent again.
    restoredBox = await Box.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: claudeAgent(),
    });

    // Ask the agent to read the file and reply with its content
    const run = await restoredBox.agent.run({
      prompt:
        "Read the file at test-file.txt and reply with ONLY its exact content, nothing else. No quotes, no explanation.",
    });

    expect(run.result).toContain(randomContent);
  }, 360000);
});

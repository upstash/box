import { describe, it, expect, afterAll } from "vitest";
import { Agent, Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

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
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Haiku_4_5 },
    });

    // Write a file with random content using exec
    const write = await sourceBox.exec.command(`echo -n '${randomContent}' > test-file.txt`);
    expect(write.exitCode).toBe(0);

    // Take a snapshot
    const snap = await sourceBox.snapshot({ name: "agent-snapshot-test" });
    expect(snap.id).toBeTruthy();
    snapshotId = snap.id;

    // Restore from snapshot with an agent configured
    restoredBox = await Box.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      // don't pass an agent, is should be restored from the snapshot
    });

    // Ask the agent to read the file and reply with its content
    const run = await restoredBox.agent.run({
      prompt:
        "Read the file at test-file.txt and reply with ONLY its exact content, nothing else. No quotes, no explanation.",
    });

    expect(run.result).toContain(randomContent);
  }, 360000);
});

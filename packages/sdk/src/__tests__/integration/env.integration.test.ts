import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Box, EphemeralBox, ClaudeCode, Agent } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("env vars", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { runner: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_6 },
      env: {
        MY_SECRET: "super-secret-value",
        APP_MODE: "production",
        EMPTY_VAR: "",
      },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("env vars are available in shell commands", async () => {
    const run = await box.exec.command("echo $MY_SECRET");
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("super-secret-value");
  });

  it("multiple env vars are set", async () => {
    const run = await box.exec.command("echo $APP_MODE");
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("production");
  });

  it("env vars are available in inline code", async () => {
    const run = await box.exec.code({
      code: "console.log(process.env.MY_SECRET)",
      lang: "js",
    });
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("super-secret-value");
  });
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("env vars — Box.fromSnapshot", () => {
  let sourceBox: Box;
  let restoredBox: Box;
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

  it("creates a source box with env vars and snapshots it", async () => {
    sourceBox = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { runner: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_6 },
      env: { SOURCE_VAR: "from-source" },
    });

    const run = await sourceBox.exec.command("echo $SOURCE_VAR");
    expect(run.result).toContain("from-source");

    const snap = await sourceBox.snapshot({ name: "env-box-from-snap" });
    expect(snap.status).toBe("ready");
    snapshotId = snap.id;
  }, 120000);

  it("restores with env and checks env vars", async () => {
    restoredBox = await Box.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { runner: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_6 },
    });

    const sourceVar = await restoredBox.exec.command("echo SOURCE_VAR=$SOURCE_VAR");
    console.log("Box.fromSnapshot SOURCE_VAR:", JSON.stringify(sourceVar.result));
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("env vars — EphemeralBox.create", () => {
  let box: EphemeralBox;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("creates an ephemeral box with env vars", async () => {
    box = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
      env: { EPH_VAR: "ephemeral-value", MODE: "test" },
    });

    expect(box.id).toBeTruthy();
  }, 30000);

  it("env vars are available in shell", async () => {
    const run = await box.exec.command("echo $EPH_VAR");
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("ephemeral-value");
  });

  it("multiple env vars are set", async () => {
    const run = await box.exec.command("echo $MODE");
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("test");
  });
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("env vars — EphemeralBox.fromSnapshot", () => {
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

  it("creates a source ephemeral box with env vars and snapshots it", async () => {
    sourceBox = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
      env: { ORIGINAL_VAR: "from-create", SHARED_VAR: "original-value" },
    });

    const run = await sourceBox.exec.command("echo $ORIGINAL_VAR");
    expect(run.result).toContain("from-create");

    const snap = await sourceBox.snapshot({ name: "env-ephemeral-from-snap" });
    expect(snap.status).toBe("ready");
    snapshotId = snap.id;
  }, 120000);

  it("restores with new env vars and logs behavior", async () => {
    restoredBox = await EphemeralBox.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      ttl: 300,
      env: { NEW_VAR: "from-restore", SHARED_VAR: "overridden-value" },
    });

    expect(restoredBox.id).not.toBe(sourceBox.id);

    const originalVar = await restoredBox.exec.command("echo ORIGINAL_VAR=$ORIGINAL_VAR");
    const newVar = await restoredBox.exec.command("echo NEW_VAR=$NEW_VAR");
    const sharedVar = await restoredBox.exec.command("echo SHARED_VAR=$SHARED_VAR");

    console.log("EphemeralBox.fromSnapshot ORIGINAL_VAR:", JSON.stringify(originalVar.result));
    console.log("EphemeralBox.fromSnapshot NEW_VAR:", JSON.stringify(newVar.result));
    console.log("EphemeralBox.fromSnapshot SHARED_VAR:", JSON.stringify(sharedVar.result));
  }, 120000);
});

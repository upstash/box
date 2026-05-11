import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent, Box } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

const HARNESS_PATH = "/workspace/home/harness.mjs";

// A minimal node-based custom harness script that emits the box-sse-v1 protocol
// without depending on the SDK being installed inside the box. Echoes the prompt
// back so tests can assert it was received intact.
const HARNESS_SCRIPT = `
const args = process.argv.slice(2);
function read(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : "";
}
const prompt = read("-p") || read("--prompt");
const model = read("--model") || "custom";
const sessionId = read("--session") || "";

function emit(event, data) {
  process.stdout.write(\`event: \${event}\\ndata: \${JSON.stringify(data)}\\n\\n\`);
}

const output = \`CUSTOM_HARNESS_OK \${prompt}\`;
emit("text", { text: output });
emit("done", {
  output,
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  total_cost_usd: 0,
  session_id: sessionId,
});
`;

describe.skipIf(!UPSTASH_BOX_API_KEY)("custom harness — Box.create", () => {
  let box: Box;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("creates a box with a custom harness without an agent API key", async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      runtime: "node",
      agent: {
        harness: Agent.Custom,
        customHarness: {
          command: "node",
          args: [HARNESS_PATH],
        },
      },
    });

    expect(box.id).toBeTruthy();
    expect(box.modelConfig.harness).toBe(Agent.Custom);
    // Defaulted by the SDK when no model is provided.
    expect(box.modelConfig.model).toBe("custom");
  }, 120000);

  it("reconnected box reflects the custom harness", async () => {
    const reconnected = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(reconnected.modelConfig.harness).toBe(Agent.Custom);
  });

  it("forwards a non-default model label to the backend", async () => {
    const labeled = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      runtime: "node",
      agent: {
        harness: Agent.Custom,
        model: "custom/demo",
        customHarness: { command: "node", args: [HARNESS_PATH] },
      },
    });

    try {
      expect(labeled.modelConfig.harness).toBe(Agent.Custom);
      expect(labeled.modelConfig.model).toBe("custom/demo");
    } finally {
      await labeled.delete().catch(() => {});
    }
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("custom harness — configureCustomHarness", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      runtime: "node",
      agent: {
        harness: Agent.Custom,
        customHarness: { command: "node", args: [HARNESS_PATH] },
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

  it("updates the custom harness config on an existing box", async () => {
    await expect(
      box.configureCustomHarness({
        command: "node",
        args: [HARNESS_PATH, "--updated"],
        protocol: "box-sse-v1",
      }),
    ).resolves.toBeUndefined();

    expect(box.modelConfig.harness).toBe(Agent.Custom);
  });

  it("rejects configureCustomHarness on a non-custom box", async () => {
    const plain = await Box.create({ apiKey: UPSTASH_BOX_API_KEY!, runtime: "node" });
    try {
      await expect(
        plain.configureCustomHarness({ command: "node", args: [HARNESS_PATH] }),
      ).rejects.toThrow("Custom harness can only be configured on custom agent boxes");
    } finally {
      await plain.delete().catch(() => {});
    }
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("custom harness — agent.run end-to-end", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      runtime: "node",
      agent: {
        harness: Agent.Custom,
        customHarness: { command: "node", args: [HARNESS_PATH] },
      },
    });

    await box.files.write({ path: "harness.mjs", content: HARNESS_SCRIPT });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("agent.run executes the custom harness and round-trips the prompt", async () => {
    const run = await box.agent.run({ prompt: "hello-from-test" });
    expect(run.result).toContain("CUSTOM_HARNESS_OK hello-from-test");
    expect(run.status).toBe("completed");
  }, 120000);

  it("agent.stream yields text-delta chunks from the custom harness", async () => {
    let text = "";
    let chunkCount = 0;
    const run = await box.agent.stream({ prompt: "stream-from-test" });
    for await (const chunk of run) {
      chunkCount++;
      if (chunk.type === "text-delta") {
        text += chunk.text;
      }
    }
    expect(chunkCount).toBeGreaterThan(0);
    expect(text).toContain("CUSTOM_HARNESS_OK stream-from-test");
    expect(run.status).toBe("completed");
  }, 120000);
});

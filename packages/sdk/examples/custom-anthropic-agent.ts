import { Agent, Box } from "@upstash/box";

const agentSource = String.raw`
const args = process.argv.slice(2);

function readArg(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function emit(event, data) {
  process.stdout.write("event: " + event + "\n");
  process.stdout.write("data: " + JSON.stringify(data) + "\n\n");
}

const prompt = readArg("-p");
const model = readArg("--model", "claude-haiku-4-5-20251001");
const sessionId = readArg("--session") || crypto.randomUUID();

try {
  emit("tool", {
    name: "anthropic_messages",
    input: { model },
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error?.message ?? "Anthropic request failed: " + response.status);
  }

  const output =
    body.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") ?? "";

  emit("text", { text: output });
  emit("done", {
    output,
    input_tokens: body.usage?.input_tokens ?? 0,
    output_tokens: body.usage?.output_tokens ?? 0,
    session_id: sessionId,
  });
} catch (error) {
  emit("error", {
    error: error instanceof Error ? error.message : String(error),
    session_id: sessionId,
  });
  process.exitCode = 1;
}
`;

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: "node",
  agent: {
    harness: Agent.Custom,
    model: "claude-haiku-4-5-20251001",
    customHarness: {
      command: "node",
      args: ["/workspace/home/custom-anthropic-agent.mjs"],
      protocol: "box-sse-v1",
    },
  },
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  },
});

console.log(`Created box: ${box.id}`);

try {
  await box.files.write({
    path: "custom-anthropic-agent.mjs",
    content: agentSource,
  });

  const run = await box.agent.run({
    prompt: "Say hello from an Anthropic-powered custom agent.",
  });

  console.log(run.result);
  console.log(`Tokens: ${run.cost.inputTokens + run.cost.outputTokens}`);
} finally {
  await box.delete();
  console.log("Box deleted.");
}

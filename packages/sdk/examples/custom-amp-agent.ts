import { Agent, Box } from "@upstash/box";

// Amp custom agent harness (ampcode.com)
//
// Runs the Amp CLI in execute mode and translates its Claude Code-compatible
// stream JSON into box-sse-v1 events. Box sessions map to Amp threads.
// MCP servers are passed with --mcp-config; prompt files are inlined (text)
// or saved under /workspace/home/.box-attachments (images, PDFs).
//
// Needs AMP_API_KEY: an access token from ampcode.com/settings (Security),
// starts with sgamp_. The model is an Amp mode: low, medium, high, or ultra.
//
// Cost is reported as 0: Amp's stream JSON has token counts but no price. Amp
// bills in credits; `amp threads usage <thread-id>` shows a thread's cost.

const agentSource = String.raw`
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { basename } from "path";
import { createInterface } from "readline";

const WORK_DIR = "/workspace/home";
const ATTACHMENTS_DIR = WORK_DIR + "/.box-attachments";
const MCP_CONFIG_PATH = WORK_DIR + "/.box-internal/mcp-config.json";

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = readArg("--model");
const session = readArg("--session");

const emit = (event, data) => process.stdout.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");

const TEXT_TYPES = ["application/json", "application/javascript", "application/typescript",
  "application/xml", "application/yaml", "application/toml", "application/sql"];
const isText = (mime) => mime.startsWith("text/") || TEXT_TYPES.includes(mime.split(";")[0]);

// Text files are inlined; other files (images, PDFs) are saved so Amp can read them by path.
function buildPrompt(base) {
  const filesPath = process.env.PROMPT_FILES_PATH;
  if (!filesPath) return base;
  const files = JSON.parse(readFileSync(filesPath, "utf-8"));
  try { unlinkSync(filesPath); } catch {}
  const fence = String.fromCharCode(96, 96, 96);
  let prompt = base;
  files.forEach((f, i) => {
    const name = basename(f.filename || "file-" + i);
    const data = Buffer.from(f.data, "base64");
    if (isText(f.media_type)) {
      prompt += "\n\nAttached file: " + name + "\n" + fence + "\n" + data.toString("utf-8") + "\n" + fence;
    } else {
      const dir = ATTACHMENTS_DIR + "/" + randomUUID();
      mkdirSync(dir, { recursive: true });
      writeFileSync(dir + "/" + name, data);
      prompt += "\n\nAttached file: " + dir + "/" + name;
    }
  });
  return prompt;
}

function mcpConfig() {
  let servers;
  try { servers = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8")); } catch { return []; }
  const config = {};
  for (const s of servers) {
    config[s.name] = s.source === "npm"
      ? { command: "npx", args: ["-y", s.package_or_url, ...(s.args ?? [])], env: s.headers ?? {} }
      : { url: s.package_or_url, headers: s.headers ?? {} };
  }
  return servers.length ? ["--mcp-config", JSON.stringify(config)] : [];
}

if (process.env.JSON_SCHEMA) console.error("[amp] Warning: JSON_SCHEMA is not supported by the Amp harness");
if (process.env.AGENT_OPTIONS) console.error("[amp] Warning: AGENT_OPTIONS are not supported by the Amp harness");

const ampArgs = [
  ...(session ? ["threads", "continue", session] : ["--no-archive-after-execute"]),
  "--dangerously-allow-all",
  "--stream-json",
  ...mcpConfig(),
  ...(mode && mode !== "custom" ? ["-m", mode] : []),
  "-x", buildPrompt(readArg("-p") ?? ""),
];

const amp = spawn("amp", ampArgs, { cwd: WORK_DIR, stdio: ["ignore", "pipe", "pipe"] });

let stderr = "";
amp.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });

let threadId = session ?? "";
let output = "";
let inputTokens = 0, outputTokens = 0, cachedInputTokens = 0;
let finished = false;

for await (const line of createInterface({ input: amp.stdout })) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (event.session_id) threadId = event.session_id;

  if (event.type === "assistant") {
    const usage = event.message?.usage ?? {};
    inputTokens += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    cachedInputTokens += usage.cache_read_input_tokens ?? 0;
    outputTokens += usage.output_tokens ?? 0;
    for (const part of event.message?.content ?? []) {
      if (part.type === "text") emit("text", { text: part.text });
      if (part.type === "tool_use") emit("tool", { name: part.name, toolCallId: part.id, input: part.input ?? {} });
    }
  } else if (event.type === "user") {
    for (const part of event.message?.content ?? []) {
      if (part.type !== "tool_result") continue;
      const content = typeof part.content === "string" ? part.content : JSON.stringify(part.content);
      emit("tool_result", { toolCallId: part.tool_use_id, output: content, is_error: part.is_error ?? false });
    }
  } else if (event.type === "result") {
    finished = true;
    const meta = { input_tokens: inputTokens, output_tokens: outputTokens, cached_input_tokens: cachedInputTokens, total_cost_usd: 0, session_id: threadId };
    if (event.is_error) emit("error", { error: event.error ?? event.result ?? "Amp run failed", ...meta });
    else emit("done", { output: event.result ?? output, ...meta });
  }
}

const code = await new Promise((resolve) => amp.on("close", resolve));
if (!finished) {
  emit("error", { error: "amp exited with code " + code + ": " + stderr.trim().split("\n").slice(-5).join("\n"), session_id: threadId });
  process.exit(1);
}
`;

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: "node",
  agent: {
    harness: Agent.Custom,
    model: "medium",
    customHarness: {
      command: "node",
      args: ["/workspace/home/custom-amp-agent.mjs"],
      protocol: "box-sse-v1",
    },
  },
  env: {
    AMP_API_KEY: process.env.AMP_API_KEY!,
  },
});

console.log(`Created box: ${box.id}`);

try {
  console.log("Installing Amp...");
  await box.exec.command("sudo -n npm install -g @sourcegraph/amp");

  await box.files.write({
    path: "custom-amp-agent.mjs",
    content: agentSource,
  });

  console.log("\n=== Turn 1 ===");
  const run1 = await box.agent.run({
    prompt: "Create a file called hello.txt with the content 'Hello from Amp!'",
  });
  console.log(run1.result);

  console.log("\n=== Turn 2 (follow-up) ===");
  const stream = await box.agent.stream({
    prompt: "Now read back the file you just created.",
  });
  for await (const chunk of stream) {
    if (chunk.type === "text-delta") process.stdout.write(chunk.text);
  }
  console.log();
} finally {
  await box.delete();
  console.log("\nBox deleted.");
}

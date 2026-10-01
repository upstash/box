import { Agent, Box } from "@upstash/box";

// GitHub Copilot CLI custom agent harness (github.com/github/copilot-cli)
//
// Runs Copilot CLI in prompt mode and translates its JSONL output into
// box-sse-v1 events. Box sessions map to Copilot session ids.
// MCP servers are passed with --additional-mcp-config; prompt files are inlined
// (text) or saved under /workspace/home/.box-attachments (images, PDFs).
//
// Auth, either:
// - Your own model key (no Copilot subscription needed): set COPILOT_PROVIDER_TYPE
//   (anthropic, openai, or azure), COPILOT_PROVIDER_BASE_URL, and COPILOT_PROVIDER_API_KEY.
//   The model is the provider's model id. This example uses ANTHROPIC_API_KEY.
// - A Copilot subscription: set COPILOT_GITHUB_TOKEN to a fine-grained token with the
//   "Copilot Requests" permission, and use a Copilot model id (or "auto").
// Token usage is read from Copilot's session store (~/.copilot/session-store.db),
// since its JSON output does not include it.

const agentSource = String.raw`
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename } from "path";
import { createInterface } from "readline";
import { DatabaseSync } from "node:sqlite";

const WORK_DIR = "/workspace/home";
const ATTACHMENTS_DIR = WORK_DIR + "/.box-attachments";
const MCP_CONFIG_PATH = WORK_DIR + "/.box-internal/mcp-config.json";
const USAGE_DB_PATH = (process.env.COPILOT_HOME ?? homedir() + "/.copilot") + "/session-store.db";

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = readArg("--model");
const session = readArg("--session");
const sessionId = session ?? randomUUID();

const emit = (event, data) => process.stdout.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");

const TEXT_TYPES = ["application/json", "application/javascript", "application/typescript",
  "application/xml", "application/yaml", "application/toml", "application/sql"];
const isText = (mime) => mime.startsWith("text/") || TEXT_TYPES.includes(mime.split(";")[0]);

// Text files are inlined; other files (images, PDFs) are saved so Copilot can read them by path.
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
  const mcpServers = {};
  for (const s of servers) {
    mcpServers[s.name] = s.source === "npm"
      ? { type: "local", command: "npx", args: ["-y", s.package_or_url, ...(s.args ?? [])], env: s.headers ?? {}, tools: ["*"] }
      : { type: "http", url: s.package_or_url, headers: s.headers ?? {}, tools: ["*"] };
  }
  return servers.length ? ["--additional-mcp-config", JSON.stringify({ mcpServers })] : [];
}

// Copilot records one row per model call; sum this session's rows written after afterId.
function readUsage(afterId) {
  try {
    const db = new DatabaseSync(USAGE_DB_PATH, { readOnly: true });
    if (afterId === undefined) return db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM assistant_usage_events").get().id;
    const row = db.prepare(
      "SELECT SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cache_read_tokens) AS cached " +
      "FROM assistant_usage_events WHERE session_id = ? AND id > ?"
    ).get(sessionId, afterId);
    return { input_tokens: (row.input ?? 0) - (row.cached ?? 0), output_tokens: row.output ?? 0, cached_input_tokens: row.cached ?? 0 };
  } catch {
    return afterId === undefined ? 0 : { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  }
}

if (process.env.JSON_SCHEMA) console.error("[copilot] Warning: JSON_SCHEMA is not supported by the Copilot harness");
if (process.env.AGENT_OPTIONS) console.error("[copilot] Warning: AGENT_OPTIONS are not supported by the Copilot harness");

const copilotArgs = [
  ...(session ? ["--resume", session] : ["--session-id", sessionId]),
  "--allow-all",
  "--no-ask-user",
  "--output-format", "json",
  ...mcpConfig(),
  ...(model && model !== "custom" ? ["--model", model] : []),
  "-p", buildPrompt(readArg("-p") ?? ""),
];

const usageStart = readUsage();
const copilot = spawn("copilot", copilotArgs, { cwd: WORK_DIR, stdio: ["ignore", "pipe", "pipe"] });

let stderr = "";
copilot.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });

const streamed = new Set();
let output = "";
let lastError = "";
let result;

for await (const line of createInterface({ input: copilot.stdout })) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  const data = event.data ?? {};

  if (event.type === "assistant.message_delta") {
    streamed.add(data.messageId);
    emit("text", { text: data.deltaContent });
  } else if (event.type === "assistant.message") {
    if (!data.content) continue;
    output = data.content;
    if (!streamed.has(data.messageId)) emit("text", { text: data.content });
  } else if (event.type === "assistant.reasoning_delta") {
    emit("thinking", { text: data.deltaContent });
  } else if (event.type === "tool.execution_start") {
    emit("tool", { name: data.toolName, toolCallId: data.toolCallId, input: data.arguments ?? {} });
  } else if (event.type === "tool.execution_complete") {
    const content = data.result?.content ?? data.error?.message ?? "";
    emit("tool_result", { toolCallId: data.toolCallId, output: content, is_error: data.success === false });
  } else if (event.type === "session.error") {
    lastError = data.message;
  } else if (event.type === "result") {
    result = event;
  }
}

const code = await new Promise((resolve) => copilot.on("close", resolve));
const meta = { ...readUsage(usageStart), total_cost_usd: 0, session_id: sessionId };
if (result?.exitCode === 0) {
  emit("done", { output, ...meta });
} else {
  const reason = lastError || stderr.trim().split("\n").slice(-5).join("\n");
  emit("error", { error: "copilot exited with code " + (result?.exitCode ?? code) + ": " + reason, ...meta });
  process.exit(1);
}
`;

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: "node",
  agent: {
    harness: Agent.Custom,
    model: "claude-sonnet-5-5",
    customHarness: {
      command: "node",
      args: ["/workspace/home/custom-copilot-agent.mjs"],
      protocol: "box-sse-v1",
    },
  },
  env: {
    COPILOT_PROVIDER_TYPE: "anthropic",
    COPILOT_PROVIDER_BASE_URL: "https://api.anthropic.com",
    COPILOT_PROVIDER_API_KEY: process.env.ANTHROPIC_API_KEY!,
  },
});

console.log(`Created box: ${box.id}`);

try {
  console.log("Installing Copilot CLI...");
  await box.exec.command("sudo -n npm install -g @github/copilot");

  await box.files.write({
    path: "custom-copilot-agent.mjs",
    content: agentSource,
  });

  console.log("\n=== Turn 1 ===");
  const run1 = await box.agent.run({
    prompt: "Create a file called hello.txt with the content 'Hello from Copilot!'",
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

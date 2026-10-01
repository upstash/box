import { Agent, Box } from "@upstash/box";

// Gemini CLI custom agent harness (github.com/google-gemini/gemini-cli)
//
// Runs Gemini CLI in headless mode and translates its stream JSON into
// box-sse-v1 events. Box sessions map to Gemini CLI session ids.
// MCP servers are written to ~/.gemini/settings.json; prompt files are inlined
// (text) or saved under /workspace/home/.box-attachments (images, PDFs).
//
// Needs GEMINI_API_KEY from aistudio.google.com/apikey.

const agentSource = String.raw`
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename } from "path";
import { createInterface } from "readline";

const WORK_DIR = "/workspace/home";
const ATTACHMENTS_DIR = WORK_DIR + "/.box-attachments";
const MCP_CONFIG_PATH = WORK_DIR + "/.box-internal/mcp-config.json";
const SETTINGS_DIR = homedir() + "/.gemini";
const SETTINGS_PATH = SETTINGS_DIR + "/settings.json";
const MANAGED_MCP_PATH = SETTINGS_DIR + "/box-mcp-servers.json";

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
// Strip a provider prefix, e.g. "google/gemini-3.5-flash" -> "gemini-3.5-flash"
const model = readArg("--model")?.split("/").pop();
const session = readArg("--session");
const sessionId = session ?? randomUUID();

const emit = (event, data) => process.stdout.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");

const TEXT_TYPES = ["application/json", "application/javascript", "application/typescript",
  "application/xml", "application/yaml", "application/toml", "application/sql"];
const isText = (mime) => mime.startsWith("text/") || TEXT_TYPES.includes(mime.split(";")[0]);

// Text files are inlined; other files (images, PDFs) are saved so Gemini can read them by path.
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

// Gemini CLI has no per-run MCP flag, so Box's servers are synced into its user
// settings. The names the harness added are tracked so servers removed from the box
// are removed here too, without touching servers configured by hand.
function writeMcpSettings() {
  let servers = [];
  try { servers = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8")); } catch {}
  let managed = [];
  try { managed = JSON.parse(readFileSync(MANAGED_MCP_PATH, "utf-8")); } catch {}
  if (!servers.length && !managed.length) return;

  let settings = {};
  try { settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")); } catch {}
  settings.mcpServers = settings.mcpServers ?? {};
  for (const name of managed) delete settings.mcpServers[name];
  for (const s of servers) {
    settings.mcpServers[s.name] = s.source === "npm"
      ? { command: "npx", args: ["-y", s.package_or_url, ...(s.args ?? [])], env: s.headers ?? {} }
      : { httpUrl: s.package_or_url, headers: s.headers ?? {} };
  }
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  writeFileSync(MANAGED_MCP_PATH, JSON.stringify(servers.map((s) => s.name)));
}

if (process.env.JSON_SCHEMA) console.error("[gemini-cli] Warning: JSON_SCHEMA is not supported by the Gemini CLI harness");
if (process.env.AGENT_OPTIONS) console.error("[gemini-cli] Warning: AGENT_OPTIONS are not supported by the Gemini CLI harness");

writeMcpSettings();

const geminiArgs = [
  ...(session ? ["--resume", session] : ["--session-id", sessionId]),
  "--approval-mode", "yolo",
  "--skip-trust",
  "-o", "stream-json",
  ...(model && model !== "custom" ? ["-m", model] : []),
  "-p", buildPrompt(readArg("-p") ?? ""),
];

const gemini = spawn("gemini", geminiArgs, { cwd: WORK_DIR, stdio: ["ignore", "pipe", "pipe"] });

let stderr = "";
gemini.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });

let output = "";
let lastError = "";
let finished = false;

for await (const line of createInterface({ input: gemini.stdout })) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }

  if (event.type === "message" && event.role === "assistant") {
    output += event.content;
    emit("text", { text: event.content });
  } else if (event.type === "tool_use") {
    output = "";
    emit("tool", { name: event.tool_name, toolCallId: event.tool_id, input: event.parameters ?? {} });
  } else if (event.type === "tool_result") {
    const content = typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? event.error ?? "");
    emit("tool_result", { toolCallId: event.tool_id, output: content, is_error: event.status === "error" });
  } else if (event.type === "error") {
    lastError = event.message;
  } else if (event.type === "result") {
    finished = true;
    const stats = event.stats ?? {};
    const meta = {
      input_tokens: stats.input ?? 0,
      output_tokens: stats.output_tokens ?? 0,
      cached_input_tokens: stats.cached ?? 0,
      total_cost_usd: 0,
      session_id: sessionId,
    };
    if (event.status === "error") emit("error", { error: event.error?.message ?? (lastError || "Gemini CLI run failed"), ...meta });
    else emit("done", { output: output.trim(), ...meta });
  }
}

const code = await new Promise((resolve) => gemini.on("close", resolve));
if (!finished) {
  emit("error", { error: "gemini exited with code " + code + ": " + (lastError || stderr.trim().split("\n").slice(-5).join("\n")), session_id: sessionId });
  process.exit(1);
}
`;

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: "node",
  agent: {
    harness: Agent.Custom,
    model: "gemini-3.5-flash",
    customHarness: {
      command: "node",
      args: ["/workspace/home/custom-gemini-agent.mjs"],
      protocol: "box-sse-v1",
    },
  },
  env: {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY!,
  },
});

console.log(`Created box: ${box.id}`);

try {
  console.log("Installing Gemini CLI...");
  await box.exec.command("sudo -n npm install -g @google/gemini-cli");

  await box.files.write({
    path: "custom-gemini-agent.mjs",
    content: agentSource,
  });

  console.log("\n=== Turn 1 ===");
  const run1 = await box.agent.run({
    prompt: "Create a file called hello.txt with the content 'Hello from Gemini CLI!'",
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

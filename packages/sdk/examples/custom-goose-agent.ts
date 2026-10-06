import { Agent, Box } from "@upstash/box";

// Goose custom agent harness (github.com/aaif-goose/goose)
//
// Requires: ANTHROPIC_API_KEY (or set GOOSE_PROVIDER + GOOSE_MODEL for other providers)
//
// Goose is a Rust-based coding agent. Sessions are named so conversation
// history persists across box.agent.run() calls — same as built-in harnesses.
// Session data is stored in ~/.local/share/goose/sessions/ which is symlinked
// to the workspace volume and survives box pauses/resumes.

const agentSource = String.raw`
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { readFileSync, unlinkSync, writeFileSync, mkdirSync } from "fs";
import { basename } from "path";

const WORK_DIR = "/workspace/home";
const GOOSE_BIN = "/home/boxuser/.local/bin/goose";
const ATTACHMENTS_DIR = WORK_DIR + "/.box-attachments";

const args = process.argv.slice(2);

function readArg(name, fallback = "") {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] ?? fallback : fallback;
}

const _write = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

function emit(event, data) {
  _write("event: " + event + "\n");
  _write("data: " + JSON.stringify(data) + "\n\n");
}

function isTextMimeType(mime) {
  if (mime.startsWith("text/")) return true;
  return ["application/json","application/javascript","application/typescript",
    "application/xml","application/yaml","application/toml","application/sql"]
    .includes(mime.split(";")[0]);
}

// Text files are inlined; other files (images, PDFs) are saved so Goose can read them by path.
function buildPrompt(base) {
  if (!process.env.PROMPT_FILES_PATH) return base;
  try {
    const raw = readFileSync(process.env.PROMPT_FILES_PATH, "utf-8");
    try { unlinkSync(process.env.PROMPT_FILES_PATH); } catch {}
    const files = JSON.parse(raw);
    const fence = String.fromCharCode(96,96,96);
    const parts = [base];
    for (const f of files) {
      if (isTextMimeType(f.media_type)) {
        const content = Buffer.from(f.data, "base64").toString("utf-8");
        parts.push("\n\nAttached file: " + (f.filename || "unnamed") + "\n" + fence + "\n" + content + "\n" + fence);
      } else {
        const dir = ATTACHMENTS_DIR + "/" + randomUUID();
        mkdirSync(dir, { recursive: true });
        const path = dir + "/" + basename(f.filename || "file");
        writeFileSync(path, Buffer.from(f.data, "base64"));
        parts.push("\n\nAttached file: " + path);
      }
    }
    return parts.join("");
  } catch { return base; }
}

const prompt = readArg("-p");
// Strip provider prefix (e.g. "anthropic/claude-sonnet-4-5" → "claude-sonnet-4-5")
const rawModel = readArg("--model", "");
const model = rawModel.includes("/") ? rawModel.split("/").slice(1).join("/") : rawModel;
const sessionId = readArg("--session") || randomUUID();
const isResume = !!readArg("--session");

if (process.env.JSON_SCHEMA) {
  console.error("[goose] Warning: JSON_SCHEMA is not supported by the Goose harness");
}

// MCP servers: Goose natively supports MCP via ~/.config/goose/config.yaml extensions
const MCP_CONFIG_PATH = "/workspace/home/.box-internal/mcp-config.json";
try {
  const mcpConfigs = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8"));
  if (mcpConfigs.length > 0) {
    let yaml = "extensions:\n";
    for (const cfg of mcpConfigs) {
      const safeName = cfg.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      if (cfg.source === "npm") {
        const gooseArgs = ["-y", cfg.package_or_url, ...(cfg.args || [])];
        const argsYaml = gooseArgs.map(a => JSON.stringify(a)).join(", ");
        yaml += "  " + safeName + ":\n    name: " + safeName + "\n    type: stdio\n    cmd: npx\n    args: [" + argsYaml + "]\n    enabled: true\n";
        if (cfg.headers && Object.keys(cfg.headers).length) {
          yaml += "    envs:\n";
          for (const [k, v] of Object.entries(cfg.headers)) yaml += "      " + JSON.stringify(k) + ": " + JSON.stringify(v) + "\n";
        }
      } else if (cfg.source === "url") {
        // Use streamable_http (sse is deprecated in Goose) — supports custom headers
        yaml += "  " + safeName + ":\n    name: " + safeName + "\n    type: streamable_http\n    uri: " + cfg.package_or_url + "\n    enabled: true\n";
        if (cfg.headers && Object.keys(cfg.headers).length) {
          yaml += "    headers:\n";
          for (const [k, v] of Object.entries(cfg.headers)) yaml += "      " + JSON.stringify(k) + ": " + JSON.stringify(v) + "\n";
        }
      }
    }
    mkdirSync("/home/boxuser/.config/goose", { recursive: true });
    writeFileSync("/home/boxuser/.config/goose/config.yaml", yaml);
    console.error("[goose] MCP servers configured: " + mcpConfigs.map(c => c.name).join(", "));
  }
} catch {}

if (!prompt) {
  emit("error", { error: "no prompt provided", session_id: sessionId });
  process.exit(1);
}

let agentOpts = {};
if (process.env.AGENT_OPTIONS) {
  try {
    const parsed = JSON.parse(process.env.AGENT_OPTIONS);
    agentOpts = parsed.agentOptions ?? parsed;
    console.error("[goose] Agent options applied: " + Object.keys(agentOpts).join(", "));
  } catch (e) {
    console.error("[goose] Warning: Failed to parse AGENT_OPTIONS: " + e.message);
  }
}

process.chdir(WORK_DIR);
const fullPrompt = buildPrompt(prompt);

let output = "";
let inputTokens = 0;
let outputTokens = 0;
let cachedInputTokens = 0;
let totalCostUSD = 0;
let stderr = "";
let afterTool = false;

const toolOutput = (result) =>
  (result?.value?.content ?? []).map((c) => (c.type === "text" ? c.text : "[" + c.type + "]")).join("\n");

try {
  await new Promise((resolve, reject) => {
    // Use session name for persistence; --resume resumes an existing named session
    const gooseArgs = [
      "run",
      "--name", sessionId,
      "--text", fullPrompt,
      "--output-format", "stream-json",
    ];
    if (isResume) gooseArgs.push("--resume");
    if (model) gooseArgs.push("--model", model);

    const proc = spawn(GOOSE_BIN, gooseArgs, {
      cwd: WORK_DIR,
      env: { ...process.env, ...agentOpts },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";

    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          // Goose prints a startup banner before the JSON stream
          console.error(trimmed);
          continue;
        }
        // Tool calls and results are message content parts:
        // assistant toolRequest -> tool, user toolResponse -> tool_result
        if (event.type === "message") {
          for (const part of event.message?.content ?? []) {
            if (part.type === "text" && part.text && event.message.role === "assistant") {
              const text = afterTool ? "\n\n" + part.text : part.text;
              afterTool = false;
              output += text;
              emit("text", { text });
            } else if (part.type === "toolRequest") {
              output = "";
              const call = part.toolCall?.value ?? {};
              emit("tool", { name: call.name ?? "tool", toolCallId: part.id, input: call.arguments ?? {} });
            } else if (part.type === "toolResponse") {
              const isError = part.toolResult?.status !== "success" || part.toolResult?.value?.isError === true;
              emit("tool_result", { toolCallId: part.id, output: toolOutput(part.toolResult), is_error: isError });
              afterTool = true;
            }
          }
        } else if (event.type === "complete") {
          // input_tokens includes cache reads and writes
          cachedInputTokens = event.cache_read_input_tokens ?? 0;
          inputTokens = (event.input_tokens ?? 0) - cachedInputTokens;
          outputTokens = event.output_tokens ?? 0;
          totalCostUSD = event.cost_usd ?? 0;
        }
      }
    });

    proc.stderr.on("data", (data) => {
      stderr = (stderr + data).slice(-4000);
      process.stderr.write(data);
    });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error("goose exited with code " + code + ": " + stderr.trim().split("\n").slice(-5).join("\n")));
      else resolve(undefined);
    });
    proc.on("error", reject);
  });

  emit("done", {
    output: output.trim(),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    total_cost_usd: totalCostUSD,
    session_id: sessionId,
  });
} catch (error) {
  emit("error", {
    error: error instanceof Error ? error.message : String(error),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    total_cost_usd: totalCostUSD,
    session_id: sessionId,
  });
  process.exit(1);
}
`;

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: "node",
  agent: {
    harness: Agent.Custom,
    model: "anthropic/claude-sonnet-4-5",
    customHarness: {
      command: "node",
      args: ["/workspace/home/custom-goose-agent.mjs"],
      protocol: "box-sse-v1",
    },
  },
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    GOOSE_PROVIDER: "anthropic",
    GOOSE_DISABLE_KEYRING: "1",
    PATH: "/home/boxuser/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  },
});

console.log(`Created box: ${box.id}`);

try {
  console.log("Installing Goose...");
  await box.exec.command(`
    node --input-type=module -e "
      import { writeFileSync } from 'fs';
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
      const url = 'https://github.com/aaif-goose/goose/releases/download/stable/goose-' + arch + '-unknown-linux-gnu.tar.gz';
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      writeFileSync('/tmp/goose.tar.gz', buf);
    "
    mkdir -p /home/boxuser/.local/bin
    tar -xzf /tmp/goose.tar.gz -C /home/boxuser/.local/bin/
    chmod +x /home/boxuser/.local/bin/goose
  `);

  await box.files.write({
    path: "custom-goose-agent.mjs",
    content: agentSource,
  });

  console.log("\n=== Turn 1 ===");
  const run1 = await box.agent.run({
    prompt: "Create a file called hello.txt with the content 'Hello from Goose!'",
  });
  console.log(run1.result);

  console.log("\n=== Turn 2 (follow-up) ===");
  const run2 = await box.agent.run({
    prompt: "Read back the file you just created.",
  });
  console.log(run2.result);
} finally {
  await box.delete();
  console.log("\nBox deleted.");
}

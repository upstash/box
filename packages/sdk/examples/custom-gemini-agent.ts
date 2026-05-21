import { Agent, Box } from "@upstash/box";

// Gemini custom agent harness using @google/genai SDK
//
// Requires: GEMINI_API_KEY from https://aistudio.google.com/apikey
//
// Uses the Google GenAI SDK directly (not the CLI) so conversation history
// is persisted across box.agent.run() calls — same as built-in harnesses.
//
// Model format: any Gemini model ID, e.g. "gemini-2.5-flash"

const agentSource = String.raw`
import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";

const WORK_DIR = "/workspace/home";
const SESSIONS_DIR = "/workspace/home/.gemini-sessions";

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
        console.error("[gemini] Skipping unsupported file type: " + f.media_type + " (" + (f.filename || "unnamed") + ")");
      }
    }
    return parts.join("");
  } catch { return base; }
}

if (process.env.JSON_SCHEMA) {
  console.error("[gemini] Warning: JSON_SCHEMA is not supported by the Gemini harness");
}

// MCP is supported by the Gemini CLI (via ~/.gemini/settings.json) but not by the
// @google/genai SDK used in this harness. Switch to the CLI-based harness for MCP support.
try {
  const mcpConfigs = JSON.parse(readFileSync("/workspace/home/.box-internal/mcp-config.json", "utf-8"));
  if (mcpConfigs.length > 0) {
    console.error("[gemini] Warning: MCP servers require the Gemini CLI harness. This harness uses the @google/genai SDK which does not support MCP.");
  }
} catch {}

function loadHistory(sessionFile) {
  try {
    return JSON.parse(readFileSync(sessionFile, "utf-8"));
  } catch { return []; }
}

function saveHistory(sessionFile, history) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(sessionFile, JSON.stringify(history));
}

const prompt = readArg("-p");
const model = readArg("--model", "gemini-2.5-flash");
const sessionId = readArg("--session") || randomUUID();
const sessionFile = SESSIONS_DIR + "/" + sessionId + ".json";

if (!prompt) {
  emit("error", { error: "no prompt provided", session_id: sessionId });
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  emit("error", { error: "GEMINI_API_KEY is required", session_id: sessionId });
  process.exit(1);
}

let agentOpts = {};
if (process.env.AGENT_OPTIONS) {
  try {
    const parsed = JSON.parse(process.env.AGENT_OPTIONS);
    // SDK may wrap user's agentOptions under an "agentOptions" key
    agentOpts = parsed.agentOptions ?? parsed;
    console.error("[gemini] Agent options applied: " + Object.keys(agentOpts).join(", "));
  } catch (e) {
    console.error("[gemini] Warning: Failed to parse AGENT_OPTIONS: " + e.message);
  }
}

process.chdir(WORK_DIR);
const fullPrompt = buildPrompt(prompt);

try {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const history = loadHistory(sessionFile);

  const chat = ai.chats.create({
    model,
    history,
    ...agentOpts,
  });

  emit("tool", { name: "gemini", toolCallId: sessionId, input: { model, turns: Math.floor(history.length / 2) } });

  let output = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;

  const stream = await chat.sendMessageStream({ message: fullPrompt });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) {
      output += text;
      emit("text", { text });
    }
    // @google/genai exposes usage as { promptTokenCount, candidatesTokenCount,
    // cachedContentTokenCount, totalTokenCount } on each streamed chunk.
    // The final chunk carries cumulative counts for the call.
    const u = chunk.usageMetadata;
    if (u) {
      inputTokens = u.promptTokenCount ?? inputTokens;
      outputTokens = u.candidatesTokenCount ?? outputTokens;
      cachedInputTokens = u.cachedContentTokenCount ?? cachedInputTokens;
    }
  }

  saveHistory(sessionFile, chat.getHistory());

  emit("done", {
    output,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    session_id: sessionId,
  });
} catch (error) {
  emit("error", {
    error: error instanceof Error ? error.message : String(error),
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
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
    model: "gemini-2.5-flash",
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
  console.log("Installing @google/genai...");
  await box.exec.command(
    "cd /workspace/home && npm install @google/genai --silent"
  );

  await box.files.write({
    path: "custom-gemini-agent.mjs",
    content: agentSource,
  });

  console.log("\n=== Turn 1 ===");
  const run1 = await box.agent.run({
    prompt: "My name is Ada. What's a fun fact about Ada Lovelace?",
  });
  console.log(run1.result);

  console.log("\n=== Turn 2 (follow-up) ===");
  const run2 = await box.agent.run({
    prompt: "What's my name?",
  });
  console.log(run2.result);

  console.log(`\nTokens used: ${run2.cost.inputTokens + run2.cost.outputTokens}`);
} finally {
  await box.delete();
  console.log("\nBox deleted.");
}

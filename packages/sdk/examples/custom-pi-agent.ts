import { Agent, Box } from "@upstash/box";

// Pi custom agent harness (github.com/earendil-works/pi)
//
// Pi is an open-source coding agent that supports multiple LLM providers.
// Pass the API key for whichever provider you use:
//   Anthropic → ANTHROPIC_API_KEY
//   Google    → GEMINI_API_KEY
//   OpenAI    → OPENAI_API_KEY
//
// Model format: "<provider>/<model-id>"
//   e.g. "anthropic/claude-sonnet-5-5"
//        "google/gemini-3.5-flash"
//        "openai/gpt-6.1-sol"
//
// MCP servers are written to the session's mcp.json and loaded by Pi's MCP
// extension. Images are passed to Pi natively; text files are inlined; other
// files are saved under /workspace/home/.box-attachments.

const PI_VERSION = "0.99.2";

const agentSource = String.raw`
import {
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { basename } from "path";

const WORK_DIR = "/workspace/home";
const SESSIONS_DIR = WORK_DIR + "/.pi-sessions";
const ATTACHMENTS_DIR = WORK_DIR + "/.box-attachments";
const MCP_CONFIG_PATH = WORK_DIR + "/.box-internal/mcp-config.json";

const args = process.argv.slice(2);

function readArg(name, fallback = "") {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] ?? fallback : fallback;
}

// Redirect SDK stdout noise to stderr so only SSE events hit stdout
const _write = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

// Resolves once the event is written, so it isn't cut off by process.exit()
function emit(event, data) {
  _write("event: " + event + "\n");
  return new Promise((resolve) => _write("data: " + JSON.stringify(data) + "\n\n", resolve));
}

const prompt = readArg("-p");
const modelStr = readArg("--model", "anthropic/claude-sonnet-5-5");
const sessionId = readArg("--session") || randomUUID();
const sessionDir = SESSIONS_DIR + "/" + sessionId;

if (!prompt) {
  await emit("error", { error: "no prompt provided", session_id: sessionId });
  process.exit(1);
}

const TEXT_TYPES = ["application/json", "application/javascript", "application/typescript",
  "application/xml", "application/yaml", "application/x-yaml", "application/toml",
  "application/sql", "application/graphql"];
const isText = (mime) => mime.startsWith("text/") || TEXT_TYPES.includes(mime.split(";")[0]);

// Text files are inlined, images go to Pi as image content, other files are saved
// so Pi can read them by path.
function buildPrompt(base) {
  const filesPath = process.env.PROMPT_FILES_PATH;
  if (!filesPath) return { text: base, images: [] };
  const files = JSON.parse(readFileSync(filesPath, "utf-8"));
  try { unlinkSync(filesPath); } catch {}
  const fence = String.fromCharCode(96, 96, 96);
  let text = base;
  const images = [];
  files.forEach((f, i) => {
    const name = basename(f.filename || "file-" + i);
    if (f.media_type.startsWith("image/")) {
      images.push({ type: "image", data: f.data, mimeType: f.media_type });
    } else if (isText(f.media_type)) {
      text += "\n\nAttached file: " + name + "\n" + fence + "\n" + Buffer.from(f.data, "base64").toString("utf-8") + "\n" + fence;
    } else {
      const dir = ATTACHMENTS_DIR + "/" + randomUUID();
      mkdirSync(dir, { recursive: true });
      writeFileSync(dir + "/" + name, Buffer.from(f.data, "base64"));
      text += "\n\nAttached file: " + dir + "/" + name;
    }
  });
  return { text, images };
}

// Pi's MCP extension reads mcp.json from the agent directory (PI_CODING_AGENT_DIR).
// "direct" exposure declares the tools to the model instead of hiding them behind codemode.
function writeMcpConfig() {
  let servers;
  try { servers = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8")); } catch { return; }
  const mcpServers = {};
  for (const s of servers) {
    mcpServers[s.name] = s.source === "npm"
      ? { command: "npx", args: ["-y", s.package_or_url, ...(s.args ?? [])], env: s.headers ?? {}, exposure: "direct" }
      : { url: s.package_or_url, headers: s.headers ?? {}, exposure: "direct" };
  }
  writeFileSync(sessionDir + "/mcp.json", JSON.stringify({ mcpServers }, null, 2));
}

if (process.env.JSON_SCHEMA) {
  console.error("[pi] Warning: JSON_SCHEMA is not supported by the Pi harness");
}

function agentOptions() {
  if (!process.env.AGENT_OPTIONS) return {};
  try {
    const opts = JSON.parse(process.env.AGENT_OPTIONS);
    console.error("[pi] Agent options applied: " + Object.keys(opts).join(", "));
    return opts;
  } catch (e) {
    console.error("[pi] Warning: Failed to parse AGENT_OPTIONS: " + e.message);
    return {};
  }
}

const toolOutput = (result) =>
  (result?.content ?? []).map((c) => (c.type === "text" ? c.text : "[" + c.type + "]")).join("\n");

let inputTokens = 0;
let outputTokens = 0;
let cachedInputTokens = 0;
let totalCostUSD = 0;

try {
  process.chdir(WORK_DIR);
  mkdirSync(sessionDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = sessionDir;
  writeMcpConfig();

  // Parse "provider/model-id"; a bare id defaults to Anthropic
  const slash = modelStr.indexOf("/");
  const provider = slash === -1 ? "anthropic" : modelStr.slice(0, slash);
  const modelId = slash === -1 ? modelStr : modelStr.slice(slash + 1);
  const modelRuntime = await ModelRuntime.create();
  const model = modelRuntime.getModel(provider, modelId);
  if (!model) throw new Error("Unknown Pi model: " + modelStr);

  const resourceLoader = new DefaultResourceLoader({
    cwd: WORK_DIR,
    agentDir: sessionDir,
    extensionFactories: [createMcpExtension()],
  });
  await resourceLoader.reload();

  // Each session gets its own agentDir so continueRecent() is scoped to it
  const { session } = await createAgentSession({
    cwd: WORK_DIR,
    agentDir: sessionDir,
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.continueRecent(WORK_DIR, sessionDir),
    ...agentOptions(),
  });
  await session.bindExtensions({});

  let output = "";

  // Pi attaches usage to each AssistantMessage as { input, output, cacheRead,
  // cacheWrite, cost: { total } }. We sum across all assistant messages
  // produced in this turn (the agent may loop with tool calls).
  function accumulateUsage(messages) {
    for (const m of messages ?? []) {
      if (m?.role !== "assistant" || !m.usage) continue;
      inputTokens += (m.usage.input ?? 0) + (m.usage.cacheWrite ?? 0);
      outputTokens += m.usage.output ?? 0;
      cachedInputTokens += m.usage.cacheRead ?? 0;
      totalCostUSD += m.usage.cost?.total ?? 0;
    }
  }

  let lastAssistant;
  let resolveEnd;
  const agentEndPromise = new Promise((resolve) => { resolveEnd = resolve; });

  session.subscribe((event) => {
    if (event.type === "message_update") {
      const ae = event.assistantMessageEvent;
      if (ae.type === "text_delta") {
        output += ae.delta;
        emit("text", { text: ae.delta });
      } else if (ae.type === "thinking_delta") {
        emit("thinking", { text: ae.delta });
      }
    } else if (event.type === "tool_execution_start") {
      output = "";
      emit("tool", { name: event.toolName, toolCallId: event.toolCallId, input: event.args ?? {} });
    } else if (event.type === "tool_execution_end") {
      emit("tool_result", { toolCallId: event.toolCallId, output: toolOutput(event.result), is_error: event.isError ?? false });
    } else if (event.type === "agent_end") {
      accumulateUsage(event.messages);
      lastAssistant = (event.messages ?? []).filter((m) => m?.role === "assistant").pop();
      resolveEnd();
    }
  });

  const { text, images } = buildPrompt(prompt);
  await session.prompt(text, images.length ? { images } : undefined);
  await agentEndPromise;
  session.dispose();

  // Pi reports model errors (bad key, rate limit) on the message instead of throwing
  if (lastAssistant?.stopReason === "error") throw new Error(lastAssistant.errorMessage ?? "Pi run failed");

  await emit("done", {
    output: output.trim(),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    total_cost_usd: totalCostUSD,
    session_id: sessionId,
  });
  process.exit(0);
} catch (error) {
  console.error(error);
  await emit("error", {
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
    model: "anthropic/claude-sonnet-5-5",
    customHarness: {
      command: "node",
      args: ["/workspace/home/custom-pi-agent.mjs"],
      protocol: "box-sse-v1",
    },
  },
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  },
});

console.log(`Created box: ${box.id}`);

try {
  console.log("Installing @earendil-works/pi-coding-agent...");
  await box.exec.command(
    `cd /workspace/home && npm install @earendil-works/pi-coding-agent@${PI_VERSION} --silent`
  );

  await box.files.write({
    path: "custom-pi-agent.mjs",
    content: agentSource,
  });

  console.log("\n=== Turn 1 ===");
  const run1 = await box.agent.run({
    prompt: "Create a file called hello.txt with the content 'Hello from Pi agent!'",
  });
  console.log(run1.result);

  console.log("\n=== Turn 2 (follow-up) ===");
  const run2 = await box.agent.run({
    prompt: "Now read back the file you just created.",
  });
  console.log(run2.result);
} finally {
  await box.delete();
  console.log("\nBox deleted.");
}

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
//   e.g. "anthropic/claude-sonnet-4-5"
//        "google/gemini-2.5-pro"
//        "openai/gpt-4o"

const agentSource = String.raw`
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { readFileSync, unlinkSync } from "fs";

const WORK_DIR = "/workspace/home";
const SESSIONS_DIR = "/workspace/home/.pi-sessions";
const MCP_CONFIG_PATH = "/workspace/home/.box-internal/mcp-config.json";

function loadMcpServers() {
  try {
    const configs = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8"));
    if (!configs.length) return { urls: [], warned: false };
    const urls = [];
    let warned = false;
    for (const cfg of configs) {
      if (cfg.source === "url") {
        urls.push(cfg.package_or_url);
        if (cfg.headers && Object.keys(cfg.headers).length) {
          console.error("[pi] Warning: headers for MCP server '" + cfg.name + "' are not supported by extensionUrls — headers will be ignored");
        }
      } else {
        console.error("[pi] Warning: npm MCP server '" + cfg.name + "' not supported; only HTTP MCP servers are applied");
        warned = true;
      }
    }
    if (urls.length) console.error("[pi] MCP servers: " + urls.join(", "));
    return { urls, warned };
  } catch { return { urls: [], warned: false }; }
}

const args = process.argv.slice(2);

function readArg(name, fallback = "") {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] ?? fallback : fallback;
}

// Redirect SDK stdout noise to stderr so only SSE events hit stdout
const _write = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

function emit(event, data) {
  _write("event: " + event + "\n");
  _write("data: " + JSON.stringify(data) + "\n\n");
}

const prompt = readArg("-p");
const modelStr = readArg("--model", "anthropic/claude-sonnet-4-5");
const sessionId = readArg("--session") || randomUUID();
const sessionDir = SESSIONS_DIR + "/" + sessionId;

if (!prompt) {
  emit("error", { error: "no prompt provided", session_id: sessionId });
  process.exit(1);
}

function isTextMimeType(mime) {
  if (mime.startsWith("text/")) return true;
  return ["application/json","application/javascript","application/typescript",
    "application/xml","application/yaml","application/x-yaml","application/toml",
    "application/sql","application/graphql"].includes(mime.split(";")[0]);
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
        console.error("[pi] Skipping unsupported file type: " + f.media_type + " (" + (f.filename || "unnamed") + ")");
      }
    }
    return parts.join("");
  } catch { return base; }
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

// Parse "provider/model-id" → getModel(provider, modelId)
function resolveModel(str) {
  const slash = str.indexOf("/");
  if (slash !== -1) {
    return getModel(str.slice(0, slash), str.slice(slash + 1));
  }
  return getModel("anthropic", str);
}

try {
  process.chdir(WORK_DIR);
  await mkdir(sessionDir, { recursive: true });

  const model = resolveModel(modelStr);
  const fullPrompt = buildPrompt(prompt);
  const extraOpts = agentOptions();
  const { urls: mcpUrls } = loadMcpServers();

  // Each session gets its own agentDir so continueRecent() is scoped to it
  const { session } = await createAgentSession({
    model,
    workingDir: WORK_DIR,
    agentDir: sessionDir,
    sessionManager: SessionManager.continueRecent(WORK_DIR, sessionDir),
    ...(mcpUrls.length ? { extensionUrls: mcpUrls } : {}),
    ...extraOpts,
  });

  emit("tool", { name: "pi_agent", toolCallId: sessionId, input: { model: modelStr } });

  let output = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let totalCostUSD = 0;

  // Pi attaches usage to each AssistantMessage as { input, output, cacheRead,
  // cacheWrite, cost: { total } }. We sum across all assistant messages
  // produced in this turn (the agent may loop with tool calls).
  function accumulateUsage(messages) {
    for (const m of messages ?? []) {
      if (m?.role !== "assistant" || !m.usage) continue;
      inputTokens += m.usage.input ?? 0;
      outputTokens += m.usage.output ?? 0;
      cachedInputTokens += m.usage.cacheRead ?? 0;
      totalCostUSD += m.usage.cost?.total ?? 0;
    }
  }

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
      emit("tool", {
        name: event.toolName,
        toolCallId: event.toolCallId,
        input: event.args ?? {},
      });
    } else if (event.type === "tool_execution_end") {
      emit("tool_result", {
        toolCallId: event.toolCallId,
        output: String(event.result ?? ""),
        is_error: event.isError ?? false,
      });
    } else if (event.type === "agent_end") {
      accumulateUsage(event.messages);
      resolveEnd();
    }
  });

  await session.prompt(fullPrompt);
  await agentEndPromise;

  emit("done", {
    output,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: cachedInputTokens,
    total_cost_usd: totalCostUSD,
    session_id: sessionId,
  });
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : "";
  emit("error", {
    error: msg + "\n" + stack,
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
    "cd /workspace/home && npm install @earendil-works/pi-coding-agent @earendil-works/pi-ai --silent"
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

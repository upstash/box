import readline from "node:readline";
import { interactiveSelect, type SelectItem } from "../utils/interactive-select.js";
import { bold, cyan, dim, green } from "../utils/ansi.js";
import type { CreateFlags } from "./create.js";

// ── Data ────────────────────────────────────────────────────────────────────

const RUNTIMES: SelectItem<string>[] = [
  { label: "Node.js", value: "node", description: "JavaScript / TypeScript" },
  { label: "Python", value: "python" },
  { label: "Go", value: "golang" },
  { label: "Ruby", value: "ruby" },
  { label: "Rust", value: "rust" },
];

type Provider = "claude" | "openai";

const PROVIDERS: SelectItem<Provider>[] = [
  { label: "Claude", value: "claude" },
  { label: "OpenAI Codex", value: "openai" },
];

const CLAUDE_MODELS: SelectItem<string>[] = [
  { label: "Sonnet 4.5", value: "claude/sonnet_4_5" },
  { label: "Opus 4.5", value: "claude/opus_4_5" },
  { label: "Opus 4.6", value: "claude/opus_4_6" },
  { label: "Sonnet 4", value: "claude/sonnet_4" },
  { label: "Haiku 4.5", value: "claude/haiku_4_5" },
];

const OPENAI_MODELS: SelectItem<string>[] = [
  { label: "GPT 5.3 Codex", value: "openai/gpt-5.3-codex" },
  { label: "GPT 5.3 Codex Spark", value: "openai/gpt-5.3-codex-spark" },
  { label: "GPT 5.2 Codex", value: "openai/gpt-5.2-codex" },
  { label: "GPT 5.1 Codex Max", value: "openai/gpt-5.1-codex-max" },
];

type ApiKeyOption = "upstash" | "stored" | "custom";

const API_KEY_OPTIONS: SelectItem<ApiKeyOption>[] = [
  { label: "Upstash-managed", value: "upstash" },
  { label: "Use stored key", value: "stored", description: "previously saved via UI or API" },
  { label: "Enter your own", value: "custom" },
];

type WizardAction = "agent" | "git-token" | "env-vars" | "create";

function getActionItems(hasAgent: boolean): SelectItem<WizardAction>[] {
  if (hasAgent) {
    return [
      { label: green("Create box"), value: "create" },
      { label: "Reconfigure AI agent", value: "agent" },
      { label: "Add GitHub token", value: "git-token" },
      { label: "Add environment variables", value: "env-vars" },
    ];
  }
  return [
    { label: "Configure AI agent", value: "agent" },
    { label: "Add GitHub token", value: "git-token" },
    { label: "Add environment variables", value: "env-vars" },
    { label: green("Create box"), value: "create" },
  ];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const RULE = dim("  ─────────────────────────────────────");

function printSummary(flags: Partial<CreateFlags>) {
  console.log(`\n${RULE}`);
  console.log(`  ${bold(cyan("Box configuration"))}`);
  console.log(RULE);
  console.log(`  ${cyan("Runtime:")}    ${flags.runtime ?? "node"}`);
  if (flags.agentModel) {
    console.log(`  ${cyan("Agent:")}      ${flags.agentModel}`);
    const keyLabel =
      flags.agentApiKey === "stored"
        ? "stored key"
        : flags.agentApiKey && flags.agentApiKey !== true
          ? "custom key"
          : "Upstash-managed";
    console.log(`  ${cyan("API key:")}    ${keyLabel}`);
  } else {
    console.log(`  ${cyan("Agent:")}      ${dim("none")}`);
  }
  if (flags.gitToken) {
    console.log(`  ${cyan("Git token:")}  set`);
  }
  if (flags.env && flags.env.length > 0) {
    console.log(`  ${cyan("Env vars:")}   ${flags.env.length} set`);
  }
  console.log(`${RULE}\n`);
}

// ── Agent sub-flow ──────────────────────────────────────────────────────────

async function configureAgent(result: Partial<CreateFlags>): Promise<boolean> {
  const provider = await interactiveSelect({
    prompt: cyan("Select an agent provider:"),
    items: PROVIDERS,
  });
  if (provider === undefined) return false;

  const models = provider === "claude" ? CLAUDE_MODELS : OPENAI_MODELS;
  const model = await interactiveSelect({
    prompt: cyan("Select a model:"),
    items: models,
  });
  if (model === undefined) return false;
  result.agentModel = model;

  const keyOption = await interactiveSelect({
    prompt: cyan("Agent API key:"),
    items: API_KEY_OPTIONS,
  });
  if (keyOption === undefined) return false;

  if (keyOption === "custom") {
    const key = await askQuestion("  Enter API key: ");
    if (key) {
      result.agentApiKey = key;
    } else {
      result.agentApiKey = undefined;
    }
  } else if (keyOption === "stored") {
    result.agentApiKey = "stored";
  } else {
    result.agentApiKey = undefined;
  }

  return true;
}

// ── Wizard ──────────────────────────────────────────────────────────────────

export async function createWizard(): Promise<CreateFlags | undefined> {
  const result: Partial<CreateFlags> = {};

  // 1. Select runtime
  const runtime = await interactiveSelect({
    prompt: cyan("Select a runtime:"),
    items: RUNTIMES,
  });
  if (runtime === undefined) return undefined;
  result.runtime = runtime;

  // 2. Action loop: configure agent, add tokens/env, or create
  while (true) {
    printSummary(result);

    const action = await interactiveSelect({
      prompt: cyan("Configure AI agent or environment:"),
      items: getActionItems(result.agentModel !== undefined),
    });
    if (action === undefined) return undefined;

    if (action === "create") break;

    if (action === "agent") {
      const ok = await configureAgent(result);
      if (!ok) return undefined;
    }

    if (action === "git-token") {
      const token = await askQuestion("  GitHub token: ");
      if (token) result.gitToken = token;
    }

    if (action === "env-vars") {
      const entry = await askQuestion("  Enter env var (KEY=VALUE): ");
      if (entry && entry.includes("=")) {
        result.env = result.env ?? [];
        result.env.push(entry);
      }
    }
  }

  return result as CreateFlags;
}

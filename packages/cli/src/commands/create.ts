import { Box } from "@upstash/box";
import type { AgentConfig, Runtime } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { resolveAgentApiKey } from "../agent-key.js";
import { startRepl } from "../repl/terminal.js";
import { createWizard } from "./create-wizard.js";
import { dim } from "../utils/ansi.js";

function resolveCliAgentHarness(harness: string | undefined): string | undefined {
  if (!harness) return undefined;
  switch (harness) {
    case "claude-code":
    case "codex":
    case "opencode":
    case "cursor":
      return harness;
    case "custom":
      console.error(
        "custom agent boxes require customHarness config and are not supported by this CLI command yet. Use the SDK or REST API.",
      );
      process.exit(1);
    default:
      console.error(`Unknown agent harness: ${harness}`);
      process.exit(1);
  }
}

export interface CreateFlags {
  token?: string;
  runtime?: string;
  agentModel?: string;
  agentHarness?: string;
  /** @deprecated Use `agentHarness` instead. */
  agentProvider?: string;
  /** @deprecated Use `agentProvider` instead. */
  agentRunner?: string;
  agentApiKey?: string | true;
  gitToken?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  env?: string[];
  label?: string[];
}

export async function createCommand(flags: CreateFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const agentHarness = resolveCliAgentHarness(
    flags.agentHarness ?? flags.agentProvider ?? flags.agentRunner,
  );

  const hasConfigFlags =
    flags.agentModel !== undefined ||
    flags.agentApiKey !== undefined ||
    flags.runtime !== undefined ||
    flags.gitToken !== undefined ||
    flags.gitUserName !== undefined ||
    flags.gitUserEmail !== undefined ||
    (flags.env !== undefined && flags.env.length > 0) ||
    (flags.label !== undefined && flags.label.length > 0);

  if (!hasConfigFlags && process.stdin.isTTY) {
    const wizardResult = await createWizard();
    if (!wizardResult) {
      console.log(dim("Aborted."));
      return;
    }
    flags = { ...flags, ...wizardResult };
  }

  const env: Record<string, string> = {};
  if (flags.env) {
    for (const e of flags.env) {
      const idx = e.indexOf("=");
      if (idx === -1) {
        console.error(`Invalid env format: ${e} (expected KEY=VAL)`);
        process.exit(1);
      }
      env[e.slice(0, idx)] = e.slice(idx + 1);
    }
  }

  if (flags.agentModel && !agentHarness) {
    console.error(
      "agent harness is required when --agent-model is set. Use --agent-harness (preferred), or the deprecated aliases --agent-provider / --agent-runner.",
    );
    process.exit(1);
  }

  console.log("\nCreating box...");
  const box = await Box.create({
    apiKey,
    runtime: flags.runtime as Runtime,
    agent: flags.agentModel
      ? ({
          harness: agentHarness!,
          model: flags.agentModel,
          apiKey: resolveAgentApiKey(flags.agentApiKey),
        } as AgentConfig)
      : undefined,
    git:
      flags.gitToken || flags.gitUserName || flags.gitUserEmail
        ? {
            token: flags.gitToken,
            userName: flags.gitUserName,
            userEmail: flags.gitUserEmail,
          }
        : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    labels: flags.label && flags.label.length > 0 ? flags.label : undefined,
  });

  await startRepl(box);
}

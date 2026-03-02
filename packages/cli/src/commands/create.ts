import { Box } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { resolveAgentApiKey } from "../agent-key.js";
import { startRepl } from "../repl/terminal.js";
import { createWizard } from "./create-wizard.js";
import { dim } from "../utils/ansi.js";

export interface CreateFlags {
  token?: string;
  runtime?: string;
  agentModel?: string;
  agentApiKey?: string | true;
  gitToken?: string;
  env?: string[];
}

export async function createCommand(flags: CreateFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);

  const hasConfigFlags =
    flags.agentModel !== undefined ||
    flags.agentApiKey !== undefined ||
    flags.runtime !== undefined ||
    flags.gitToken !== undefined ||
    (flags.env !== undefined && flags.env.length > 0);

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

  console.log("\nCreating box...");
  const box = await Box.create({
    apiKey,
    runtime: flags.runtime,
    agent: flags.agentModel
      ? { model: flags.agentModel, apiKey: resolveAgentApiKey(flags.agentApiKey) }
      : undefined,
    git: flags.gitToken ? { token: flags.gitToken } : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
  });

  await startRepl(box);
}

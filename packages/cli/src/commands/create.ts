import { Box } from "@buggyhunter/box";
import { resolveToken } from "../auth.js";
import { startRepl } from "../repl.js";

interface CreateFlags {
  token?: string;
  runtime?: string;
  agentModel?: string;
  agentApiKey?: string;
  gitToken?: string;
  env?: string[];
}

export async function createCommand(flags: CreateFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);

  if (!flags.agentModel) {
    console.error("Error: --agent-model is required");
    process.exit(1);
  }
  if (!flags.agentApiKey) {
    console.error("Error: --agent-api-key is required");
    process.exit(1);
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

  console.log("Creating box...");
  const box = await Box.create({
    apiKey,
    runtime: flags.runtime,
    agent: { model: flags.agentModel, apiKey: flags.agentApiKey },
    git: flags.gitToken ? { token: flags.gitToken } : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
  });

  await startRepl(box);
}

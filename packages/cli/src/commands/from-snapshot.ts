import { Box } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { startRepl } from "../repl.js";

interface FromSnapshotFlags {
  token?: string;
  runtime?: string;
  agentModel?: string;
  agentApiKey?: string;
  gitToken?: string;
  env?: string[];
}

export async function fromSnapshotCommand(snapshotId: string, flags: FromSnapshotFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);

  if (flags.agentModel && !flags.agentApiKey) {
    console.error("Error: --agent-api-key is required if --agent-model is set");
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

  console.log("Creating box from snapshot...");
  const box = await Box.fromSnapshot(snapshotId, {
    apiKey,
    runtime: flags.runtime,
    agent: (flags.agentModel && flags.agentApiKey) ? { model: flags.agentModel, apiKey: flags.agentApiKey } : undefined,
    git: flags.gitToken ? { token: flags.gitToken } : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
  });

  await startRepl(box);
}

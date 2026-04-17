import { Box } from "@upstash/box";
import { resolveToken } from "../auth.js";

interface EnvFlags {
  token?: string;
}

export async function envSetCommand(key: string, value: string, flags: EnvFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  await Box.setEnv(key, value, { apiKey });
  console.log(`Set ${key}`);
}

export async function envListCommand(flags: EnvFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const vars = await Box.listEnv({ apiKey });
  const entries = Object.entries(vars);
  if (entries.length === 0) {
    console.log("No env vars set.");
    return;
  }
  const keyWidth = Math.max(...entries.map(([k]) => k.length));
  for (const [k, v] of entries) {
    console.log(`${k.padEnd(keyWidth)}  ${v}`);
  }
}

export async function envDeleteCommand(key: string, flags: EnvFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  await Box.deleteEnv(key, { apiKey });
  console.log(`Deleted ${key}`);
}

export async function envSetAllCommand(vars: string[], flags: EnvFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const parsed: Record<string, string> = {};
  for (const entry of vars) {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      console.error(`Error: invalid format "${entry}", expected KEY=VALUE`);
      process.exit(1);
    }
    parsed[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  await Box.setAllEnv(parsed, { apiKey });
  console.log(`Set ${Object.keys(parsed).length} env var(s)`);
}

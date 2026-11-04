import dotenv from "dotenv";
import { Agent, VercelModel } from "../../index.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../../../.env") });

export const UPSTASH_BOX_API_KEY = process.env.UPSTASH_BOX_API_KEY;
export const UPSTASH_BOX_BASE_URL = process.env.UPSTASH_BOX_BASE_URL;
export const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY;
export const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;

function gatewayKey(): string {
  if (!AI_GATEWAY_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY is required for integration tests that configure an agent");
  }
  return AI_GATEWAY_API_KEY;
}

/**
 * Agents run on a Vercel AI Gateway key passed on every box, so the tests do not
 * depend on whatever provider keys are saved on the CI account.
 */
export function claudeAgent() {
  return {
    harness: Agent.ClaudeCode,
    model: VercelModel.Claude_Haiku_4_5,
    apiKey: gatewayKey(),
  } as const;
}

export function codexAgent() {
  return {
    harness: Agent.Codex,
    model: VercelModel.GPT_5_4,
    apiKey: gatewayKey(),
  } as const;
}

/**
 * Opt-in for tests that act on every resource in the account rather than only
 * the ones they created. They cannot run beside anything else on a shared key,
 * so CI leaves this unset. Set it when running against a scratch account.
 */
export const ALLOW_ACCOUNT_WIDE_TESTS = process.env.UPSTASH_BOX_ALLOW_ACCOUNT_WIDE === "1";

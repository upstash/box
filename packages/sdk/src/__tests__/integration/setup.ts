import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../../../.env") });

export const UPSTASH_BOX_API_KEY = process.env.UPSTASH_BOX_API_KEY;
export const UPSTASH_BOX_BASE_URL = process.env.UPSTASH_BOX_BASE_URL;
export const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY;

/**
 * Opt-in for tests that act on every resource in the account rather than only
 * the ones they created. They cannot run beside anything else on a shared key,
 * so CI leaves this unset. Set it when running against a scratch account.
 */
export const ALLOW_ACCOUNT_WIDE_TESTS = process.env.UPSTASH_BOX_ALLOW_ACCOUNT_WIDE === "1";

/**
 * Anonymous client telemetry, following the same header convention as the
 * Upstash Redis and QStash SDKs: three static headers describing the SDK
 * version, the JS runtime, and the deployment platform. No user data, request
 * payloads, or identifiers are ever collected.
 *
 * Disable by setting the `UPSTASH_DISABLE_TELEMETRY` environment variable, or
 * per client via the `enableTelemetry: false` config option (the only way on
 * runtimes without `process.env`, e.g. Cloudflare Workers).
 */

import { VERSION } from "./version.js";

/**
 * Read at call time (not import time) so env vars loaded after import —
 * dotenv, test setup — still take effect.
 */
function safeEnv(): Record<string, string | undefined> {
  return typeof process === "object" && process && typeof process.env === "object" && process.env
    ? process.env
    : {};
}

/**
 * Wrapping clients append their identity to the SDK chain, comma-joined on
 * the wire so the backend sees e.g. `@upstash/box@0.5.3,@upstash/box-cli@0.2.12`.
 */
const sdkChain: string[] = [`@upstash/box@${VERSION}`];

/**
 * Register a client wrapping this SDK (the CLI, agent-framework integrations)
 * so it appears in the telemetry chain. Idempotent per identity.
 *
 * @internal
 */
export function appendTelemetryIdentity(identity: string): void {
  if (!sdkChain.includes(identity)) {
    sdkChain.push(identity);
  }
}

function detectRuntime(): string {
  // @ts-expect-error EdgeRuntime is only defined on Vercel Edge
  if (typeof EdgeRuntime === "string") return "edge-light";
  if (typeof process === "object" && process) {
    const versions = process.versions as Record<string, string | undefined> | undefined;
    if (versions?.bun) return `bun@${versions.bun}`;
    if (versions?.deno) return `deno@${versions.deno}`;
    if (process.version) return `node@${process.version}`;
  }
  return "unknown";
}

/** Cloudflare Workers expose no env vars; detect them via the `caches.default` global. */
function isCloudflareWorkers(): boolean {
  const caches = (globalThis as { caches?: unknown }).caches;
  return typeof caches === "object" && caches !== null && "default" in caches;
}

function detectPlatform(env: Record<string, string | undefined>): string {
  if (env.UPSTASH_CONSOLE) return "console";
  if (env.VERCEL) return "vercel";
  if (env.CF_PAGES || isCloudflareWorkers()) return "cloudflare";
  if (env.AWS_LAMBDA_FUNCTION_NAME || env.AWS_REGION) return "aws";
  if (env.CI) return "ci";
  return "unknown";
}

let runtime: string | undefined;

/**
 * Headers to attach to every API request. Empty when telemetry is disabled —
 * via the `UPSTASH_DISABLE_TELEMETRY` env var or `enable: false` (the
 * client's `enableTelemetry` config option; the env var wins over it).
 */
export function telemetryHeaders(enable?: boolean): Record<string, string> {
  const env = safeEnv();
  if (env.UPSTASH_DISABLE_TELEMETRY !== undefined || enable === false) return {};
  runtime ??= detectRuntime();
  return {
    "Upstash-Telemetry-Sdk": sdkChain.join(","),
    "Upstash-Telemetry-Runtime": runtime,
    "Upstash-Telemetry-Platform": detectPlatform(env),
  };
}

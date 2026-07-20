import { describe, it, expect, afterEach, vi } from "vitest";
import { appendTelemetryIdentity, telemetryHeaders } from "../telemetry.js";
import { VERSION } from "../version.js";

describe("telemetryHeaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports sdk, runtime and platform", () => {
    vi.stubEnv("UPSTASH_DISABLE_TELEMETRY", undefined);
    const headers = telemetryHeaders();
    expect(headers["Upstash-Telemetry-Sdk"]).toContain(`@upstash/box@${VERSION}`);
    expect(headers["Upstash-Telemetry-Runtime"]).toMatch(/^(node|bun|deno)@/);
    expect(headers["Upstash-Telemetry-Platform"]).toBeTruthy();
  });

  it("returns no headers when UPSTASH_DISABLE_TELEMETRY is set, even after import", () => {
    vi.stubEnv("UPSTASH_DISABLE_TELEMETRY", "1");
    expect(telemetryHeaders()).toEqual({});
  });

  it("treats an empty UPSTASH_DISABLE_TELEMETRY as disabled", () => {
    vi.stubEnv("UPSTASH_DISABLE_TELEMETRY", "");
    expect(telemetryHeaders()).toEqual({});
  });

  it("detects the platform from env vars at call time", () => {
    vi.stubEnv("UPSTASH_DISABLE_TELEMETRY", undefined);
    vi.stubEnv("UPSTASH_CONSOLE", "");
    vi.stubEnv("CF_PAGES", "");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("VERCEL", "1");
    expect(telemetryHeaders()["Upstash-Telemetry-Platform"]).toBe("vercel");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("CI", "1");
    expect(telemetryHeaders()["Upstash-Telemetry-Platform"]).toBe("ci");
  });

  it("returns no headers when enableTelemetry is false", () => {
    vi.stubEnv("UPSTASH_DISABLE_TELEMETRY", undefined);
    expect(telemetryHeaders(false)).toEqual({});
  });

  it("lets the env var win over enableTelemetry: true", () => {
    vi.stubEnv("UPSTASH_DISABLE_TELEMETRY", "1");
    expect(telemetryHeaders(true)).toEqual({});
  });

  it("appends wrapping client identities comma-joined, idempotently", () => {
    vi.stubEnv("UPSTASH_DISABLE_TELEMETRY", undefined);
    appendTelemetryIdentity("@upstash/box-test-wrapper@9.9.9");
    appendTelemetryIdentity("@upstash/box-test-wrapper@9.9.9");
    const chain = telemetryHeaders()["Upstash-Telemetry-Sdk"].split(",");
    expect(chain[0]).toBe(`@upstash/box@${VERSION}`);
    expect(chain.filter((id) => id === "@upstash/box-test-wrapper@9.9.9")).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError } from "../core/errors.js";
import { resolveToken } from "../auth.js";

describe("resolveToken", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.UPSTASH_BOX_API_KEY;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns flag token when provided", () => {
    expect(resolveToken("flag-token")).toBe("flag-token");
  });

  it("returns env var when no flag", () => {
    process.env.UPSTASH_BOX_API_KEY = "env-token";
    expect(resolveToken()).toBe("env-token");
  });

  it("throws when no token is available", () => {
    // A CliError rather than process.exit, so it exits 125 through the same
    // boundary as every other CLI failure.
    expect(() => resolveToken()).toThrow(CliError);
    expect(() => resolveToken()).toThrow(/API token required/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("prefers flag over env var", () => {
    process.env.UPSTASH_BOX_API_KEY = "env-token";
    expect(resolveToken("flag-token")).toBe("flag-token");
  });
});

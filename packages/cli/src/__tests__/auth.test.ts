import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveToken } from "../auth.js";

describe("resolveToken", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.UPSTASH_BOX_TOKEN;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns flag token when provided", () => {
    expect(resolveToken("flag-token")).toBe("flag-token");
  });

  it("returns env var when no flag", () => {
    process.env.UPSTASH_BOX_TOKEN = "env-token";
    expect(resolveToken()).toBe("env-token");
  });

  it("exits when no token available", () => {
    resolveToken();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("API token required"));
  });

  it("prefers flag over env var", () => {
    process.env.UPSTASH_BOX_TOKEN = "env-token";
    expect(resolveToken("flag-token")).toBe("flag-token");
  });
});

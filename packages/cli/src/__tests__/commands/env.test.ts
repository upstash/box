import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError } from "../../core/errors.js";
import {
  envSetCommand,
  envListCommand,
  envDeleteCommand,
  envSetAllCommand,
} from "../../commands/env.js";

vi.mock("@upstash/box", () => ({
  Box: {
    setEnv: vi.fn(),
    listEnv: vi.fn(),
    deleteEnv: vi.fn(),
    setAllEnv: vi.fn(),
  },
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

import { Box } from "@upstash/box";

describe("envSetCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;
  const written = () => stdout.mock.calls.map((call) => String(call[0])).join("");

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls Box.setEnv and prints confirmation", async () => {
    vi.mocked(Box.setEnv).mockResolvedValueOnce(undefined);

    await envSetCommand("MY_KEY", "my-value", { token: "test-key" });

    expect(Box.setEnv).toHaveBeenCalledWith("MY_KEY", "my-value", { apiKey: "test-key" });
    expect(written()).toContain("Set MY_KEY");
  });
});

describe("envListCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints env vars in aligned columns", async () => {
    vi.mocked(Box.listEnv).mockResolvedValueOnce({ FOO: "****", LONG_KEY: "****" });

    await envListCommand({ token: "test-key" });

    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^FOO\s+\*\*\*\*/);
    expect(lines[1]).toMatch(/^LONG_KEY\s+\*\*\*\*/);
  });

  it("prints message when no env vars", async () => {
    vi.mocked(Box.listEnv).mockResolvedValueOnce({});

    await envListCommand({ token: "test-key" });

    expect(logSpy).toHaveBeenCalledWith("No env vars set.");
  });
});

describe("envDeleteCommand", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  const written = () => stdout.mock.calls.map((call) => String(call[0])).join("");
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls Box.deleteEnv and prints confirmation", async () => {
    vi.mocked(Box.deleteEnv).mockResolvedValueOnce(undefined);

    await envDeleteCommand("MY_KEY", { token: "test-key" });

    expect(Box.deleteEnv).toHaveBeenCalledWith("MY_KEY", { apiKey: "test-key" });
    expect(written()).toContain("Deleted MY_KEY");
  });
});

describe("envSetAllCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;
  const written = () => stdout.mock.calls.map((call) => String(call[0])).join("");
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("parses KEY=VALUE pairs and calls Box.setAllEnv", async () => {
    vi.mocked(Box.setAllEnv).mockResolvedValueOnce(undefined);

    await envSetAllCommand(["FOO=bar", "BAZ=qux"], { token: "test-key" });

    expect(Box.setAllEnv).toHaveBeenCalledWith({ FOO: "bar", BAZ: "qux" }, { apiKey: "test-key" });
    expect(written()).toContain("Set 2 env var(s)");
  });

  it("handles values that contain '='", async () => {
    vi.mocked(Box.setAllEnv).mockResolvedValueOnce(undefined);

    await envSetAllCommand(["URL=http://x.com?a=1&b=2"], { token: "test-key" });

    expect(Box.setAllEnv).toHaveBeenCalledWith(
      { URL: "http://x.com?a=1&b=2" },
      { apiKey: "test-key" },
    );
  });

  it("throws on an invalid format", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await expect(envSetAllCommand(["INVALID"], { token: "test-key" })).rejects.toThrow(/INVALID/);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { mockResponse, TEST_BOX_DATA, TEST_CONFIG } from "./helpers.js";

describe("Box.create", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
    delete process.env.UPSTASH_BOX_BASE_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates a box with happy path (already running)", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    const box = await Box.create(TEST_CONFIG);
    expect(box.id).toBe("box-123");

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("claude/sonnet_4_5");
    expect(body.agent_api_key).toBe("test-agent-key");
  });

  it("polls until box is ready", async () => {
    const creating = { ...TEST_BOX_DATA, status: "creating" };
    const running = { ...TEST_BOX_DATA, status: "running" };

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(creating)) // POST /v2/box
      .mockResolvedValueOnce(mockResponse(creating)) // poll 1
      .mockResolvedValueOnce(mockResponse(running)); // poll 2

    const box = await Box.create(TEST_CONFIG);
    expect(box.id).toBe("box-123");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("throws on error status after polling", async () => {
    const creating = { ...TEST_BOX_DATA, status: "creating" };
    const errorState = { ...TEST_BOX_DATA, status: "error" };

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(creating))
      .mockResolvedValueOnce(mockResponse(errorState));

    await expect(Box.create(TEST_CONFIG)).rejects.toThrow("Box creation failed");
  });

  it("throws when apiKey is missing", async () => {
    const config = { ...TEST_CONFIG, apiKey: undefined };
    await expect(Box.create(config)).rejects.toThrow("apiKey is required");
  });

  it("uses env var for apiKey", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    const config = { ...TEST_CONFIG, apiKey: undefined };
    const box = await Box.create(config);
    expect(box.id).toBe("box-123");

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws when agent.model is missing", async () => {
    const config = { ...TEST_CONFIG, agent: { model: "", apiKey: "key" } };
    await expect(Box.create(config)).rejects.toThrow("agent.model is required");
  });

  it("sends runtime, env, gitToken in body", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      runtime: "python",
      env: { FOO: "bar" },
      git: { token: "gh-tok" },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.runtime).toBe("python");
    expect(body.env_vars).toEqual({ FOO: "bar" });
    expect(body.github_token).toBe("gh-tok");
  });

  it("sends skills and mcpServers in body", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      skills: ["frontend-design"],
      mcpServers: [
        {
          name: "test-mcp-package",
          package: "@test/mcp",
          args: ["--option", "value"],
        },
        {
          name: "test-mcp-url",
          url: "https://mcp.example.com/sse",
          headers: { "x-key": "val" },
        },
      ],
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.skills).toEqual(["frontend-design"]);
    expect(body.mcp_servers).toEqual([
      {
        name: "test-mcp-package",
        source: "npm",
        package_or_url: "@test/mcp",
        args: ["--option", "value"],
      },
      {
        name: "test-mcp-url",
        source: "url",
        package_or_url: "https://mcp.example.com/sse",
        headers: { "x-key": "val" },
      },
    ]);
  });

  it("throws on API error response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "rate limited" }, 429));

    await expect(Box.create(TEST_CONFIG)).rejects.toThrow("rate limited");
  });
});

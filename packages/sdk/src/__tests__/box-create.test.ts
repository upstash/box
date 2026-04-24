import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { Agent, OpenAICodex } from "../types.js";
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
    expect(body.model).toBe("anthropic/claude-sonnet-4-5");
    expect(body.agent_api_key).toBe("test-agent-key");
  });

  it("sends explicit harness when provided", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      agent: { harness: Agent.Codex, model: OpenAICodex.GPT_5_4, apiKey: "k" },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.agent).toBe(Agent.Codex);
    expect(body.model).toBe(OpenAICodex.GPT_5_4);
  });

  it("supports deprecated provider field", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      agent: { provider: Agent.Codex, model: OpenAICodex.GPT_5_4, apiKey: "k" },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.agent).toBe(Agent.Codex);
    expect(body.model).toBe(OpenAICodex.GPT_5_4);
  });

  it("supports deprecated runner field", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      agent: {
        provider: Agent.Codex,
        runner: "ignored",
        model: OpenAICodex.GPT_5_4,
        apiKey: "k",
      } as any,
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.agent).toBe(Agent.Codex);
  });

  it("prefers harness over deprecated aliases", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      agent: {
        harness: Agent.OpenCode,
        provider: Agent.Codex,
        runner: Agent.ClaudeCode,
        model: "opencode/claude-sonnet-4-6",
        apiKey: "k",
      } as any,
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.agent).toBe(Agent.OpenCode);
  });

  it("falls back to runner when provider is absent", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      agent: { runner: "codex", model: "openai/gpt-5.4", apiKey: "k" } as any,
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.agent).toBe("codex");
  });

  it("throws when harness and deprecated aliases are missing", async () => {
    await expect(
      Box.create({
        ...TEST_CONFIG,
        agent: { model: "openai/gpt-5.4", apiKey: "k" } as any,
      }),
    ).rejects.toThrow(
      "agent.harness is required. Deprecated aliases agent.provider and agent.runner are still accepted.",
    );
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
    const config = { ...TEST_CONFIG, agent: { provider: "claude-code", model: "", apiKey: "key" } };
    await expect(Box.create(config)).rejects.toThrow("agent.model is required");
  });

  it("allows git object without token", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await expect(Box.create({ ...TEST_CONFIG, git: {} })).resolves.toBeDefined();
  });

  it("sends runtime, env, git config in body", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      runtime: "python",
      env: { FOO: "bar" },
      git: {
        token: "gh-tok",
        userName: "John Doe",
        userEmail: "john@example.com",
      },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.runtime).toBe("python");
    expect(body.env_vars).toEqual({ FOO: "bar" });
    expect(body.github_token).toBe("gh-tok");
    expect(body.git_user_name).toBe("John Doe");
    expect(body.git_user_email).toBe("john@example.com");
  });

  it("sends keep_alive and init_command in body", async () => {
    const data = { ...TEST_BOX_DATA, status: "running", keep_alive: true };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    const box = await Box.create({
      ...TEST_CONFIG,
      keepAlive: true,
      initCommand: "npm install && npm run dev",
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.keep_alive).toBe(true);
    expect(body.init_command).toBe("npm install && npm run dev");
    expect(box.keepAlive).toBe(true);
  });

  it("throws when initCommand is provided without keepAlive", async () => {
    await expect(
      Box.create({
        ...TEST_CONFIG,
        initCommand: "echo hi",
      }),
    ).rejects.toThrow("initCommand requires keepAlive: true");
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

  it("sends attach_headers in body", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      attachHeaders: {
        "api.stripe.com": { Authorization: "Bearer sk_live_123" },
        "*.example.com": { "X-Custom-Token": "secret123" },
      },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.attach_headers).toEqual({
      "api.stripe.com": { Authorization: "Bearer sk_live_123" },
      "*.example.com": { "X-Custom-Token": "secret123" },
    });
  });

  it("does not send attach_headers when not set", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create(TEST_CONFIG);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.attach_headers).toBeUndefined();
  });

  it("sends name in body when provided", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({ ...TEST_CONFIG, name: "my-box" });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.name).toBe("my-box");
  });

  it("omits name from body when not provided", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create(TEST_CONFIG);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.name).toBeUndefined();
  });

  it("sends network_policy with allow-all mode", async () => {
    const data = {
      ...TEST_BOX_DATA,
      status: "running",
      network_policy: { mode: "allow-all" as const },
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    const box = await Box.create({ ...TEST_CONFIG, networkPolicy: { mode: "allow-all" } });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.network_policy).toEqual({ mode: "allow-all" });
    expect(box.networkPolicy).toEqual({ mode: "allow-all" });
  });

  it("sends network_policy with deny-all mode", async () => {
    const data = {
      ...TEST_BOX_DATA,
      status: "running",
      network_policy: { mode: "deny-all" as const },
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    const box = await Box.create({ ...TEST_CONFIG, networkPolicy: { mode: "deny-all" } });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.network_policy).toEqual({ mode: "deny-all" });
    expect(box.networkPolicy).toEqual({ mode: "deny-all" });
  });

  it("sends network_policy with custom mode", async () => {
    const data = {
      ...TEST_BOX_DATA,
      status: "running",
      network_policy: {
        mode: "custom" as const,
        allowed_domains: ["api.example.com"],
        allowed_cidrs: ["10.0.0.0/8"],
        denied_cidrs: ["192.168.0.0/16"],
      },
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create({
      ...TEST_CONFIG,
      networkPolicy: {
        mode: "custom",
        allowedDomains: ["api.example.com"],
        allowedCidrs: ["10.0.0.0/8"],
        deniedCidrs: ["192.168.0.0/16"],
      },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.network_policy).toEqual({
      mode: "custom",
      allowed_domains: ["api.example.com"],
      allowed_cidrs: ["10.0.0.0/8"],
      denied_cidrs: ["192.168.0.0/16"],
    });
  });

  it("networkPolicy defaults to allow-all when not in response", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    const box = await Box.create(TEST_CONFIG);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.network_policy).toBeUndefined();
    expect(box.networkPolicy).toEqual({ mode: "allow-all" });
  });

  it("sends size in body when provided", async () => {
    const data = { ...TEST_BOX_DATA, status: "running", size: "large" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    const box = await Box.create({ ...TEST_CONFIG, size: "large" });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.size).toBe("large");
    expect(box.size).toBe("large");
  });

  it("omits size from body when not provided", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.create(TEST_CONFIG);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.size).toBeUndefined();
  });

  it("defaults size to small when not in response", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    const box = await Box.create(TEST_CONFIG);
    expect(box.size).toBe("small");
  });

  it("throws on API error response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "rate limited" }, 429));

    await expect(Box.create(TEST_CONFIG)).rejects.toThrow("rate limited");
  });
});

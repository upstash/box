import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { mockResponse, TEST_BOX_DATA, TEST_CONFIG } from "./helpers.js";
import type { AgentCredential, BoxLogEntryWithBox, GitHubRepo, GitHubBranch, Snapshot } from "../types.js";

const TEST_LOG: BoxLogEntryWithBox = {
  box_id: "box-123",
  timestamp: 1700000000,
  level: "info",
  source: "system",
  message: "agent started",
};

const TEST_SNAPSHOT: Snapshot = {
  id: "snap-1",
  name: "weekly-backup",
  box_id: "box-123",
  size_bytes: 2048,
  status: "ready",
  created_at: 1700000000,
};

// ──────────────────────────────────────────────────────────────────────────────
// Box.allLogs
// ──────────────────────────────────────────────────────────────────────────────

describe("Box.allLogs", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /v2/box/logs with default limit of 200", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ logs: [TEST_LOG] }));

    const logs = await Box.allLogs({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/logs?limit=200`);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.box_id).toBe("box-123");
    expect(logs[0]!.message).toBe("agent started");
  });

  it("uses a custom limit when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ logs: [] }));

    await Box.allLogs({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl, limit: 50 });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("limit=50");
  });

  it("returns an empty array when there are no logs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ logs: [] }));

    const logs = await Box.allLogs({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(logs).toEqual([]);
  });

  it("returns logs from multiple boxes", async () => {
    const multiLogs: BoxLogEntryWithBox[] = [
      { ...TEST_LOG, box_id: "box-1" },
      { ...TEST_LOG, box_id: "box-2", message: "task done" },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ logs: multiLogs }));

    const logs = await Box.allLogs({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    expect(logs).toHaveLength(2);
    expect(logs[0]!.box_id).toBe("box-1");
    expect(logs[1]!.box_id).toBe("box-2");
  });

  it("sends the correct auth header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ logs: [] }));

    await Box.allLogs({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe(TEST_CONFIG.apiKey);
  });

  it("throws BoxError when apiKey is missing", async () => {
    await expect(Box.allLogs()).rejects.toThrow("apiKey is required");
    await expect(Box.allLogs()).rejects.toThrow(BoxError);
  });

  it("uses UPSTASH_BOX_API_KEY env var", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ logs: [] }));

    await Box.allLogs();

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "forbidden" }, 403));

    await expect(
      Box.allLogs({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("forbidden");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Box.allSnapshots
// ──────────────────────────────────────────────────────────────────────────────

describe("Box.allSnapshots", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /v2/box/snapshots and returns Snapshot[]", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ snapshots: [TEST_SNAPSHOT] }));

    const snaps = await Box.allSnapshots({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/snapshots`);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.id).toBe("snap-1");
    expect(snaps[0]!.name).toBe("weekly-backup");
  });

  it("returns snapshots from multiple boxes", async () => {
    const snapshotList: Snapshot[] = [
      { ...TEST_SNAPSHOT, box_id: "box-1", id: "snap-1" },
      { ...TEST_SNAPSHOT, box_id: "box-2", id: "snap-2" },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ snapshots: snapshotList }));

    const snaps = await Box.allSnapshots({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(snaps).toHaveLength(2);
    expect(snaps[1]!.box_id).toBe("box-2");
  });

  it("returns an empty array when response has no snapshots", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ snapshots: [] }));

    const snaps = await Box.allSnapshots({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(snaps).toEqual([]);
  });

  it("returns an empty array when snapshots field is missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    const snaps = await Box.allSnapshots({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(snaps).toEqual([]);
  });

  it("sends the correct auth header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ snapshots: [] }));

    await Box.allSnapshots({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe(TEST_CONFIG.apiKey);
  });

  it("throws BoxError when apiKey is missing", async () => {
    await expect(Box.allSnapshots()).rejects.toThrow("apiKey is required");
    await expect(Box.allSnapshots()).rejects.toThrow(BoxError);
  });

  it("uses UPSTASH_BOX_API_KEY env var", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ snapshots: [] }));

    await Box.allSnapshots();

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "unauthorized" }, 401));

    await expect(
      Box.allSnapshots({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("unauthorized");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Box.listAgentCredentials / setAgentCredential / deleteAgentCredential
// ──────────────────────────────────────────────────────────────────────────────

const TEST_CREDENTIAL: AgentCredential = {
  provider: "anthropic",
  key_prefix: "sk-ant-****",
  created_at: 1700000000,
};

describe("Box.listAgentCredentials", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /v2/box/agent-credentials and returns AgentCredential[]", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ credentials: [TEST_CREDENTIAL] }),
    );

    const creds = await Box.listAgentCredentials({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/agent-credentials`);
    expect(init?.method).toBe("GET");
    expect(creds).toHaveLength(1);
    expect(creds[0]!.provider).toBe("anthropic");
    expect(creds[0]!.key_prefix).toBe("sk-ant-****");
  });

  it("returns empty array when no credentials exist", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ credentials: [] }));

    const creds = await Box.listAgentCredentials({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(creds).toEqual([]);
  });

  it("sends the correct auth header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ credentials: [] }));

    await Box.listAgentCredentials({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe(TEST_CONFIG.apiKey);
  });

  it("throws BoxError when apiKey is missing", async () => {
    await expect(Box.listAgentCredentials()).rejects.toThrow("apiKey is required");
    await expect(Box.listAgentCredentials()).rejects.toThrow(BoxError);
  });
});

describe("Box.setAgentCredential", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to /v2/box/agent-credentials with provider and api_key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.setAgentCredential(
      { provider: "openai", api_key: "sk-openai-123" },
      { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl },
    );

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/agent-credentials`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.provider).toBe("openai");
    expect(body.api_key).toBe("sk-openai-123");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "invalid key" }, 400));

    await expect(
      Box.setAgentCredential(
        { provider: "anthropic", api_key: "bad-key" },
        { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl },
      ),
    ).rejects.toThrow("invalid key");
  });
});

describe("Box.deleteAgentCredential", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("DELETEs /v2/box/agent-credentials/:provider", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.deleteAgentCredential("anthropic", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/agent-credentials/anthropic`);
    expect(init?.method).toBe("DELETE");
  });

  it("DELETEs correct path for openai provider", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.deleteAgentCredential("openai", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/v2/box/agent-credentials/openai");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Box.gitHubStatus / gitHubInstallURL / gitHubRepos / gitHubBranches / disconnectGitHub
// ──────────────────────────────────────────────────────────────────────────────

const TEST_GITHUB_REPO: GitHubRepo = {
  full_name: "acme/my-repo",
  name: "my-repo",
  owner: "acme",
  private: false,
  default_branch: "main",
};

const TEST_BRANCH: GitHubBranch = { name: "feature/add-auth" };

describe("Box.gitHubStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /v2/box/github/status and returns connected status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ connected: true, installation_id: 12345 }),
    );

    const status = await Box.gitHubStatus({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/github/status`);
    expect(init?.method).toBe("GET");
    expect(status.connected).toBe(true);
    expect(status.installation_id).toBe(12345);
  });

  it("returns connected: false when GitHub is not connected", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ connected: false }));

    const status = await Box.gitHubStatus({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(status.connected).toBe(false);
    expect(status.installation_id).toBeUndefined();
  });

  it("throws BoxError when apiKey is missing", async () => {
    await expect(Box.gitHubStatus()).rejects.toThrow("apiKey is required");
  });
});

describe("Box.gitHubInstallURL", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /v2/box/github/install-url and returns the URL", async () => {
    const installUrl = "https://github.com/apps/upstash-box/installations/new";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ url: installUrl }));

    const result = await Box.gitHubInstallURL({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/github/install-url`);
    expect(result.url).toBe(installUrl);
  });
});

describe("Box.gitHubRepos", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /v2/box/github/repos and returns GitHubRepo[]", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse([TEST_GITHUB_REPO]));

    const repos = await Box.gitHubRepos({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/github/repos`);
    expect(init?.method).toBe("GET");
    expect(repos).toHaveLength(1);
    expect(repos[0]!.full_name).toBe("acme/my-repo");
    expect(repos[0]!.default_branch).toBe("main");
  });

  it("returns empty array when no repos", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse([]));

    const repos = await Box.gitHubRepos({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(repos).toEqual([]);
  });
});

describe("Box.gitHubBranches", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /v2/box/github/repos/:owner/:repo/branches", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse([TEST_BRANCH, { name: "main" }]));

    const branches = await Box.gitHubBranches("acme", "my-repo", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/github/repos/acme/my-repo/branches`);
    expect(init?.method).toBe("GET");
    expect(branches).toHaveLength(2);
    expect(branches[0]!.name).toBe("feature/add-auth");
  });

  it("encodes owner and repo in the URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse([]));

    await Box.gitHubBranches("my-org", "awesome-project", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/v2/box/github/repos/my-org/awesome-project/branches");
  });
});

describe("Box.disconnectGitHub", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("DELETEs /v2/box/github/installation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.disconnectGitHub({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/github/installation`);
    expect(init?.method).toBe("DELETE");
  });

  it("throws BoxError when apiKey is missing", async () => {
    await expect(Box.disconnectGitHub()).rejects.toThrow("apiKey is required");
  });
});

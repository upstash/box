import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EphemeralBox, BoxError } from "../client.js";
import { mockResponse, TEST_BOX_DATA } from "./helpers.js";

const EPHEMERAL_BOX_DATA = {
  ...TEST_BOX_DATA,
  status: "idle",
  ephemeral: true,
  expires_at: 1773745700,
};

const EPHEMERAL_CONFIG = {
  apiKey: "test-api-key",
  baseUrl: "https://test.api.example.com",
};

describe("EphemeralBox.create", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
    delete process.env.UPSTASH_BOX_BASE_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates an ephemeral box with default config", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    const box = await EphemeralBox.create(EPHEMERAL_CONFIG);

    expect(box.id).toBe("box-123");
    expect(box.expiresAt).toBe(1773745700);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${EPHEMERAL_CONFIG.baseUrl}/v2/box`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.ephemeral).toBe(true);
    expect(body.ttl).toBeUndefined();
    expect(body.runtime).toBeUndefined();
  });

  it("does not poll — returns immediately", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.create(EPHEMERAL_CONFIG);

    // Only one fetch call — no polling
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("sends runtime and ttl in body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.create({
      ...EPHEMERAL_CONFIG,
      runtime: "python",
      ttl: 1800,
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.ephemeral).toBe(true);
    expect(body.runtime).toBe("python");
    expect(body.ttl).toBe(1800);
  });

  it("sends env_vars in body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.create({
      ...EPHEMERAL_CONFIG,
      env: { MY_VAR: "hello", SECRET: "s3cret" },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.env_vars).toEqual({ MY_VAR: "hello", SECRET: "s3cret" });
  });

  it("does not send env_vars when env is not set", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.create(EPHEMERAL_CONFIG);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.env_vars).toBeUndefined();
  });

  it("sends ttl: 0 when explicitly set", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.create({ ...EPHEMERAL_CONFIG, ttl: 0 });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.ttl).toBe(0);
  });

  it("sends name in body when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.create({ ...EPHEMERAL_CONFIG, name: "my-ephemeral" });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.name).toBe("my-ephemeral");
  });

  it("sends network_policy in body when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.create({
      ...EPHEMERAL_CONFIG,
      networkPolicy: { mode: "custom", allowedDomains: ["example.com"] },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.network_policy).toEqual({
      mode: "custom",
      allowed_domains: ["example.com"],
    });
  });

  it("throws when apiKey is missing", async () => {
    await expect(EphemeralBox.create()).rejects.toThrow("apiKey is required");
  });

  it("uses env var for apiKey", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    const box = await EphemeralBox.create();
    expect(box.id).toBe("box-123");

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "rate limited" }, 429));

    await expect(EphemeralBox.create(EPHEMERAL_CONFIG)).rejects.toThrow("rate limited");
  });

  it("does not send agent, git, or snapshot fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.create(EPHEMERAL_CONFIG);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.model).toBeUndefined();
    expect(body.agent).toBeUndefined();
    expect(body.github_token).toBeUndefined();
    expect(body.snapshot_id).toBeUndefined();
    expect(body.skills).toBeUndefined();
    expect(body.mcp_servers).toBeUndefined();
  });
});

describe("EphemeralBox instance", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.restoreAllMocks());

  async function createBox() {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));
    return EphemeralBox.create(EPHEMERAL_CONFIG);
  }

  it("exposes exec namespace", async () => {
    const box = await createBox();
    expect(box.exec).toBeDefined();
    expect(typeof box.exec.command).toBe("function");
    expect(typeof box.exec.code).toBe("function");
    expect(typeof box.exec.stream).toBe("function");
    expect(typeof box.exec.streamCode).toBe("function");
  });

  it("exposes files namespace", async () => {
    const box = await createBox();
    expect(box.files).toBeDefined();
    expect(typeof box.files.read).toBe("function");
    expect(typeof box.files.write).toBe("function");
    expect(typeof box.files.list).toBe("function");
    expect(typeof box.files.upload).toBe("function");
    expect(typeof box.files.download).toBe("function");
  });

  it("exposes schedule namespace", async () => {
    const box = await createBox();
    expect(box.schedule).toBeDefined();
    expect(typeof box.schedule.exec).toBe("function");
    expect(typeof box.schedule.agent).toBe("function");
    expect(typeof box.schedule.list).toBe("function");
    expect(typeof box.schedule.get).toBe("function");
    expect(typeof box.schedule.pause).toBe("function");
    expect(typeof box.schedule.resume).toBe("function");
    expect(typeof box.schedule.delete).toBe("function");
  });

  it("does not expose agent, git, or preview namespaces", async () => {
    const box = await createBox();
    expect((box as any).agent).toBeUndefined();
    expect((box as any).git).toBeUndefined();
    expect((box as any).preview).toBeUndefined();
  });

  it("exposes snapshot, listSnapshots, and deleteSnapshot", async () => {
    const box = await createBox();
    expect(typeof box.snapshot).toBe("function");
    expect(typeof box.listSnapshots).toBe("function");
    expect(typeof box.deleteSnapshot).toBe("function");
  });

  it("exposes cwd and cd", async () => {
    const box = await createBox();
    expect(box.cwd).toBe("/workspace/home");
    expect(typeof box.cd).toBe("function");
  });

  it("exposes getStatus", async () => {
    const box = await createBox();
    expect(typeof box.getStatus).toBe("function");
  });

  it("exposes delete", async () => {
    const box = await createBox();
    expect(typeof box.delete).toBe("function");
  });

  it("delegates exec.command to the internal box", async () => {
    const box = await createBox();

    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ exit_code: 0, output: "hello\n" }));

    const run = await box.exec.command("echo hello");
    expect(run.result).toBe("hello\n");
    expect(run.status).toBe("completed");
  });

  it("delegates files.read to the internal box", async () => {
    const box = await createBox();

    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ content: "file content" }));

    const content = await box.files.read("test.txt");
    expect(content).toBe("file content");
  });

  it("delegates delete to the internal box", async () => {
    const box = await createBox();

    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await box.delete();

    const [url, init] = vi.mocked(fetch).mock.calls[1]!;
    expect(url).toContain(`/v2/box/${box.id}`);
    expect(init?.method).toBe("DELETE");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scheduleUpdateCommand } from "../../commands/schedule.js";

/**
 * `schedule update --effort` through the real SDK, with only the network
 * stubbed. The other schedule tests mock the SDK whole, so they cannot see what
 * the SDK's option mapping does to the merged options on the way to the PATCH.
 */
describe("schedule update --effort through the SDK", () => {
  let patched: Record<string, unknown> | undefined;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  function backend(harness: string, agentOptions: Record<string, unknown>) {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const schedule = {
      id: "sch-1",
      type: "prompt",
      cron: "@daily",
      status: "active",
      prompt: "noop",
      agent_options: agentOptions,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        if (method === "GET" && url.pathname === "/v2/box/b1") {
          return json({ id: "b1", agent: harness, model: "some/model", status: "running" });
        }
        if (url.pathname === "/v2/box/b1/schedules/sch-1") {
          if (method === "GET") return json(schedule);
          if (method === "PATCH") {
            patched = JSON.parse(String(init?.body));
            return json({ ...schedule, ...patched });
          }
        }
        return new Response("unexpected request", { status: 500 });
      }),
    );
  }

  beforeEach(() => {
    patched = undefined;
    process.env.UPSTASH_BOX_BASE_URL = "https://box.test";
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.UPSTASH_BOX_BASE_URL;
    stdout.mockRestore();
    stderr.mockRestore();
  });

  const flags = { box: "b1", token: "box_test" };

  it("replaces a stored Codex effort and keeps the other options", async () => {
    // Codex options are stored snake_case, and the new effort is camelCase
    // until the SDK maps it: both end up under model_reasoning_effort.
    backend("codex", { model_reasoning_effort: "high", personality: "pragmatic" });

    await scheduleUpdateCommand("sch-1", [], { ...flags, effort: "low" });

    expect(patched).toEqual({
      agent_options: { personality: "pragmatic", model_reasoning_effort: "low" },
    });
  });

  it("sets the effort inside a stored OpenRouter extra_body.reasoning", async () => {
    // The runner sends extra_body.reasoning over reasoningEffort, so leaving the
    // stored one alone would keep the old effort in every scheduled run.
    backend("opencode", {
      extra_body: { reasoning: { effort: "high", exclude: true }, transforms: ["middle-out"] },
      textVerbosity: "low",
    });

    await scheduleUpdateCommand("sch-1", [], { ...flags, effort: "low" });

    expect(patched).toEqual({
      agent_options: {
        extra_body: { reasoning: { effort: "low", exclude: true }, transforms: ["middle-out"] },
        textVerbosity: "low",
        reasoningEffort: "low",
      },
    });
  });

  it("swaps a stored reasoning token budget for the effort", async () => {
    // OpenRouter takes effort or max_tokens; keeping both leaves it ambiguous.
    backend("opencode", { extra_body: { reasoning: { max_tokens: 4096 } } });

    await scheduleUpdateCommand("sch-1", [], { ...flags, effort: "medium" });

    expect(patched).toEqual({
      agent_options: {
        extra_body: { reasoning: { effort: "medium" } },
        reasoningEffort: "medium",
      },
    });
  });

  it("keeps Claude Code options as they are", async () => {
    backend("claude-code", { maxTurns: 5, effort: "high" });

    await scheduleUpdateCommand("sch-1", [], { ...flags, effort: "max" });

    expect(patched).toEqual({ agent_options: { maxTurns: 5, effort: "max" } });
  });
});

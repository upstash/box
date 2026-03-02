import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/interactive-select.js", () => ({
  interactiveSelect: vi.fn(),
}));

vi.mock("node:readline", () => {
  const answers: string[] = [];
  return {
    default: {
      createInterface: vi.fn(() => ({
        question: (_query: string, cb: (answer: string) => void) => {
          cb(answers.shift() ?? "");
        },
        close: vi.fn(),
      })),
    },
    __answers: answers,
  };
});

import { interactiveSelect } from "../../utils/interactive-select.js";
import { createWizard } from "../../commands/create-wizard.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __answers } = (await import("node:readline")) as any;

beforeEach(() => {
  vi.clearAllMocks();
  __answers.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("createWizard", () => {
  it("happy path: Claude model + Upstash key", async () => {
    vi.mocked(interactiveSelect)
      .mockResolvedValueOnce("python") // runtime
      .mockResolvedValueOnce("agent") // action: configure agent
      .mockResolvedValueOnce("claude") // provider
      .mockResolvedValueOnce("claude/sonnet_4_5") // model
      .mockResolvedValueOnce("upstash") // API key option
      .mockResolvedValueOnce("create"); // action: create

    const result = await createWizard();

    expect(result).toEqual({
      runtime: "python",
      agentModel: "claude/sonnet_4_5",
    });
  });

  it("no agent → only runtime set", async () => {
    vi.mocked(interactiveSelect)
      .mockResolvedValueOnce("node") // runtime
      .mockResolvedValueOnce("create"); // action: create directly

    const result = await createWizard();

    expect(result).toEqual({ runtime: "node" });
    expect(result?.agentModel).toBeUndefined();
    expect(result?.agentApiKey).toBeUndefined();
  });

  it("OpenAI model + custom API key", async () => {
    __answers.push("sk-my-openai-key");

    vi.mocked(interactiveSelect)
      .mockResolvedValueOnce("node") // runtime
      .mockResolvedValueOnce("agent") // action: configure agent
      .mockResolvedValueOnce("openai") // provider
      .mockResolvedValueOnce("openai/gpt-5.3-codex") // model
      .mockResolvedValueOnce("custom") // API key option
      .mockResolvedValueOnce("create"); // action: create

    const result = await createWizard();

    expect(result).toEqual({
      runtime: "node",
      agentModel: "openai/gpt-5.3-codex",
      agentApiKey: "sk-my-openai-key",
    });
  });

  it("stored key option → agentApiKey is 'stored'", async () => {
    vi.mocked(interactiveSelect)
      .mockResolvedValueOnce("node") // runtime
      .mockResolvedValueOnce("agent") // action: configure agent
      .mockResolvedValueOnce("claude") // provider
      .mockResolvedValueOnce("claude/opus_4_5") // model
      .mockResolvedValueOnce("stored") // API key option
      .mockResolvedValueOnce("create"); // action: create

    const result = await createWizard();

    expect(result?.agentApiKey).toBe("stored");
  });

  it("git token added via action loop", async () => {
    __answers.push("ghp_abc123");

    vi.mocked(interactiveSelect)
      .mockResolvedValueOnce("node") // runtime
      .mockResolvedValueOnce("git-token") // action: add git token
      .mockResolvedValueOnce("create"); // action: create

    const result = await createWizard();

    expect(result?.gitToken).toBe("ghp_abc123");
  });

  it("env vars added via action loop", async () => {
    __answers.push("FOO=bar");

    vi.mocked(interactiveSelect)
      .mockResolvedValueOnce("node") // runtime
      .mockResolvedValueOnce("env-vars") // action: add env
      .mockResolvedValueOnce("create"); // action: create

    const result = await createWizard();

    expect(result?.env).toEqual(["FOO=bar"]);
  });

  it("escape at runtime step → returns undefined", async () => {
    vi.mocked(interactiveSelect).mockResolvedValueOnce(undefined);

    const result = await createWizard();

    expect(result).toBeUndefined();
  });

  it("escape at action loop → returns undefined", async () => {
    vi.mocked(interactiveSelect)
      .mockResolvedValueOnce("node") // runtime
      .mockResolvedValueOnce(undefined); // action: escape

    const result = await createWizard();

    expect(result).toBeUndefined();
  });

  it("escape during agent sub-flow → returns undefined", async () => {
    vi.mocked(interactiveSelect)
      .mockResolvedValueOnce("node") // runtime
      .mockResolvedValueOnce("agent") // action: configure agent
      .mockResolvedValueOnce(undefined); // provider: escape

    const result = await createWizard();

    expect(result).toBeUndefined();
  });

  it("empty custom key → falls back to Upstash-managed (agentApiKey undefined)", async () => {
    __answers.push("");

    vi.mocked(interactiveSelect)
      .mockResolvedValueOnce("node") // runtime
      .mockResolvedValueOnce("agent") // action: configure agent
      .mockResolvedValueOnce("claude") // provider
      .mockResolvedValueOnce("claude/sonnet_4_5") // model
      .mockResolvedValueOnce("custom") // API key option
      .mockResolvedValueOnce("create"); // action: create

    const result = await createWizard();

    expect(result?.agentApiKey).toBeUndefined();
  });
});

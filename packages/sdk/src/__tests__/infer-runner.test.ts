import { describe, it, expect } from "vitest";
import { inferDefaultProvider, inferDefaultRunner } from "../client.js";
import { Agent } from "../types.js";

describe("inferDefaultProvider", () => {
  it("returns ClaudeCode for openrouter/ prefix", () => {
    expect(inferDefaultProvider("openrouter/deepseek-r1")).toBe(Agent.ClaudeCode);
  });

  it("returns OpenCode for opencode/ prefix", () => {
    expect(inferDefaultProvider("opencode/zen-claude-sonnet-4.5")).toBe(Agent.OpenCode);
  });

  it("returns Codex for openai/ prefix", () => {
    expect(inferDefaultProvider("openai/gpt-5.3-codex")).toBe(Agent.Codex);
  });

  it("returns ClaudeCode for claude/ prefix (default)", () => {
    expect(inferDefaultProvider("claude/sonnet_4_5")).toBe(Agent.ClaudeCode);
  });

  it("returns ClaudeCode for unknown prefix", () => {
    expect(inferDefaultProvider("some-custom-model")).toBe(Agent.ClaudeCode);
  });
});

describe("inferDefaultRunner (deprecated alias)", () => {
  it("is the same function as inferDefaultProvider", () => {
    expect(inferDefaultRunner).toBe(inferDefaultProvider);
  });
});

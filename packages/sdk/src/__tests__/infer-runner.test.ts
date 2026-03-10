import { describe, it, expect } from "vitest";
import { inferDefaultRunner } from "../client.js";
import { Agent } from "../types.js";

describe("inferDefaultRunner", () => {
  it("returns ClaudeCode for openrouter/ prefix", () => {
    expect(inferDefaultRunner("openrouter/deepseek-r1")).toBe(Agent.ClaudeCode);
  });

  it("returns OpenCode for opencode/ prefix", () => {
    expect(inferDefaultRunner("opencode/zen-claude-sonnet-4.5")).toBe(Agent.OpenCode);
  });

  it("returns Codex for openai/ prefix", () => {
    expect(inferDefaultRunner("openai/gpt-5.3-codex")).toBe(Agent.Codex);
  });

  it("returns ClaudeCode for claude/ prefix (default)", () => {
    expect(inferDefaultRunner("claude/sonnet_4_5")).toBe(Agent.ClaudeCode);
  });

  it("returns ClaudeCode for unknown prefix", () => {
    expect(inferDefaultRunner("some-custom-model")).toBe(Agent.ClaudeCode);
  });
});

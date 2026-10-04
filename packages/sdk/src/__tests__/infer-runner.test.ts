import { describe, it, expect } from "vitest";
import { inferDefaultProvider, inferDefaultRunner } from "../client.js";
import { Agent } from "../types.js";

describe("inferDefaultProvider", () => {
  it("returns ClaudeCode for openrouter/ prefix", () => {
    expect(inferDefaultProvider("openrouter/deepseek-r1")).toBe(Agent.ClaudeCode);
  });

  it("returns ClaudeCode for vercel/anthropic prefix", () => {
    expect(inferDefaultProvider("vercel/anthropic/claude-opus-4.7")).toBe(Agent.ClaudeCode);
  });

  it("returns Codex for vercel/openai prefix", () => {
    expect(inferDefaultProvider("vercel/openai/gpt-5.5")).toBe(Agent.Codex);
  });

  it("returns Codex for neon/gpt-* models", () => {
    expect(inferDefaultProvider("neon/gpt-5-5")).toBe(Agent.Codex);
    expect(inferDefaultProvider("neon/gpt-5-3-codex")).toBe(Agent.Codex);
    expect(inferDefaultProvider("neon/gpt-6-astra")).toBe(Agent.Codex);
  });

  it("returns OpenCode for chat-only neon models", () => {
    expect(inferDefaultProvider("neon/gpt-oss-120b")).toBe(Agent.OpenCode);
    expect(inferDefaultProvider("neon/gemini-3-6-flash")).toBe(Agent.OpenCode);
    expect(inferDefaultProvider("neon/kimi-k3")).toBe(Agent.OpenCode);
    expect(inferDefaultProvider("neon/claude-opus-4-8")).toBe(Agent.OpenCode);
    expect(inferDefaultProvider("neon/grok-4-6")).toBe(Agent.OpenCode);
  });

  it("returns OpenCode for opencode/ prefix", () => {
    expect(inferDefaultProvider("opencode/zen-claude-sonnet-4.5")).toBe(Agent.OpenCode);
  });

  it("returns Codex for openai/ prefix", () => {
    expect(inferDefaultProvider("openai/gpt-5.3-codex")).toBe(Agent.Codex);
  });

  it("returns Cursor for cursor/ prefix", () => {
    expect(inferDefaultProvider("cursor/composer-2.5")).toBe(Agent.Cursor);
  });

  it("returns Custom for custom/ prefix", () => {
    expect(inferDefaultProvider("custom/my-runner-model")).toBe(Agent.Custom);
  });

  it("returns ClaudeCode for anthropic/ prefix", () => {
    expect(inferDefaultProvider("anthropic/claude-opus-4-7")).toBe(Agent.ClaudeCode);
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

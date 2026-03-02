import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod/v3";
import { Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

const mcpResultSchema = z.object({
  success: z.boolean(),
  content: z.string(),
});

const PROMPT =
  "Use the Context7 tool to look up documentation for the 'hono' library. " +
  "If the tool works and you find documentation, return success: true and put a short summary in content. " +
  "If there is no MCP tool available or it fails, return success: false and put the error reason in content.";

describe.skipIf(!UPSTASH_BOX_API_KEY || true)("mcp (package-based)", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Opus_4_6 },
      mcpServers: [{ name: "context7", package: "@upstash/context7-mcp" }],
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("agent can use Context7 MCP tool via package", async () => {
    const run = await box.agent.run({
      prompt: PROMPT,
      responseSchema: mcpResultSchema,
    });

    expect(run.result.success).toBe(true);
    expect(run.result.content).toBeTruthy();
  }, 180000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY || true)("mcp (url-based)", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Opus_4_6 },
      mcpServers: [{ name: "context7", url: "https://mcp.context7.com/mcp" }],
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("agent can use Context7 MCP tool via URL", async () => {
    const run = await box.agent.run({
      prompt: PROMPT,
      responseSchema: mcpResultSchema,
    });

    expect(run.result.success).toBe(true);
    expect(run.result.content).toBeTruthy();
  }, 180000);
});

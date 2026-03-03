import { describe, it, expect } from "vitest";
import { z } from "zod/v3";
import { CONTEXT7_API_KEY, UPSTASH_BOX_API_KEY, withBox } from "./setup.js";

const mcpResultSchema = z.object({
  success: z.boolean(),
  content: z.string(),
});

const PROMPT =
  "Use the Context7 tool to look up documentation for the 'hono' library. " +
  "If the tool works and you find documentation, return success: true and put a short summary in content. " +
  "If there is no MCP tool available or it fails, return success: false and put the error reason in content.";

describe.skipIf(!UPSTASH_BOX_API_KEY || !CONTEXT7_API_KEY)("mcp (package-based)", () => {
  it.concurrent(
    "agent can use Context7 MCP tool via package",
    () =>
      withBox(
        async (box) => {
          const run = await box.agent.run({
            prompt: PROMPT,
            responseSchema: mcpResultSchema,
          });

          expect(run.result.success).toBe(true);
          expect(run.result.content).toBeTruthy();
        },
        {
          mcpServers: [
            {
              name: "context7",
              package: "@upstash/context7-mcp",
              args: ["--api-key", CONTEXT7_API_KEY!],
            },
          ],
        },
      ),
    180000,
  );
});

describe.skipIf(!UPSTASH_BOX_API_KEY || !CONTEXT7_API_KEY)("mcp (url-based)", () => {
  it.concurrent(
    "agent can use Context7 MCP tool via URL",
    () =>
      withBox(
        async (box) => {
          const run = await box.agent.run({
            prompt: PROMPT,
            responseSchema: mcpResultSchema,
          });

          expect(run.result.success).toBe(true);
          expect(run.result.content).toBeTruthy();
        },
        {
          mcpServers: [
            {
              name: "context7",
              url: "https://mcp.context7.com/mcp",
              headers: { CONTEXT7_API_KEY: CONTEXT7_API_KEY! },
            },
          ],
        },
      ),
    180000,
  );
});

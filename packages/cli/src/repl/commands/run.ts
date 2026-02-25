import type { Box } from "@upstash/box";
import type { REPLHooks } from "../client.js";

/**
 * Run the agent with a prompt, streaming output via hooks.
 */
export async function handleRun(box: Box, prompt: string, hooks: REPLHooks): Promise<void> {
  if (!prompt) {
    hooks.onLog("Usage: run <prompt>");
    return;
  }
  for await (const chunk of box.agent.stream({ prompt })) {
    if (chunk.type === "text-delta") {
      hooks.onStream(chunk.text);
    }
  }
  hooks.onStream("\n");
}

import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Run the agent with a prompt, streaming output as events.
 */
export async function* handleRun(box: Box, prompt: string): AsyncGenerator<BoxREPLEvent> {
  if (!prompt) {
    yield { type: "log", message: "Usage: run <prompt>" };
    return;
  }
  for await (const chunk of box.agent.stream({ prompt })) {
    if (chunk.type === "text-delta") {
      yield { type: "stream", text: chunk.text };
    }
  }
  yield { type: "stream", text: "\n" };
}

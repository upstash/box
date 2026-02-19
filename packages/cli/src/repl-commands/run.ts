import type { Box } from "@buggyhunter/box";

/**
 * Run the agent with a prompt, streaming output to stdout.
 */
export async function handleRun(box: Box, prompt: string): Promise<void> {
  if (!prompt) {
    console.log("Usage: run <prompt>");
    return;
  }
  for await (const chunk of box.agent.stream({ prompt })) {
    process.stdout.write(chunk);
  }
  console.log();
}

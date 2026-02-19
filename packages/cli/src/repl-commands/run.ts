import type { Box } from "@buggyhunter/box";

/**
 * Run the agent with a prompt, streaming output to stdout.
 */
export async function handleRun(box: Box, prompt: string): Promise<void> {
  if (!prompt) {
    console.log("Usage: run <prompt>");
    return;
  }
  const run = await box.agent.run({
    prompt,
    onStream: (chunk) => process.stdout.write(chunk),
  });
  // Ensure newline after streaming output
  console.log();
  const cost = await run.cost();
  console.log(`[${run.id}] ${cost.tokens} tokens, ${(cost.computeMs / 1000).toFixed(1)}s`);
}

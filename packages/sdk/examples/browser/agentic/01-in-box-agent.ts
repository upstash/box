import { Box, Agent } from "@upstash/box";

// Agentic browsing, in-box agent.
// Stagehand v4 removed the built-in agent loop. On Box the replacement is not a
// client-side loop: enabling the browser (`browser: true`) auto-wires the
// chrome-devtools MCP (chrome-devtools-mcp on 127.0.0.1:9222, Chromium already
// warmed) into the box's coding agent. So `box.agent.run` hands the goal to an
// agent that lives IN the sandbox — it writes and runs the browsing work itself
// and iterates until done. Same job as Stagehand v4 "code mode", different
// primitive (an in-box coding agent + MCP, not an SDK call you script).
//
// Cost note: this bills the coding agent's model tokens, not browser-AI metering
// (`act`/`extract`/`observe`). It needs an agent harness + key, not just the box.

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  runtime: "node",
  browser: true,
  agent: {
    harness: Agent.ClaudeCode,
    model: "anthropic/claude-sonnet-4-5",
    apiKey: process.env.CLAUDE_KEY!,
  },
});

try {
  // No tab.create first: Chromium is warmed for browser boxes, and the agent
  // drives it through the chrome-devtools MCP.
  const run = await box.agent.run({
    prompt: [
      "Use the browser to scrape https://books.toscrape.com/.",
      "Open the catalogue, visit the first 5 product pages, and for each one record",
      "{ title, price, stock }.",
      "Write the array as JSON to books.json in the working directory.",
      "Verify the file parses and has 5 entries before you finish.",
    ].join(" "),
  });

  console.log("run:", run.status, run.cost);
  console.log(run.result); // the agent's final message

  if (run.status !== "completed") {
    console.error("agent run did not complete; not reading books.json");
  } else {
    // The agent produced the file inside the box; read + parse it back out.
    const books = JSON.parse(await box.files.read("books.json"));
    console.log(books);
  }
} finally {
  await box.delete();
}

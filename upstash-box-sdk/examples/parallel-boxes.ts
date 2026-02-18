import { Box, Runtime, ClaudeCode } from "@buggyhunter/box";

// Spin up multiple boxes in parallel to process different tasks concurrently.

const tasks = [
  {
    name: "API",
    prompt: `Create a REST API at output/ with Express.js:
- GET /health returns { status: "ok" }
- GET /time returns the current ISO timestamp
Include package.json. Run it to verify it works, then stop it.`,
  },
  {
    name: "CLI",
    prompt: `Create a CLI tool at output/ using Node.js:
- Command: greet <name> — prints "Hello, <name>!"
- Command: random — prints a random number between 1-100
- Use process.argv for argument parsing (no dependencies)
Include package.json with a "bin" field. Test both commands.`,
  },
  {
    name: "Library",
    prompt: `Create a utility library at output/ with TypeScript:
- slugify(text) — converts text to URL-friendly slugs
- truncate(text, maxLen) — truncates with "..."
- capitalize(text) — capitalizes first letter of each word
Include package.json, tsconfig.json, and tests with vitest. Run tests.`,
  },
];

console.log(`Launching ${tasks.length} boxes in parallel...\n`);

const results = await Promise.all(
  tasks.map(async (task) => {
    const start = Date.now();

    const box = await Box.create({
      apiKey: process.env.UPSTASH_BOX_API_KEY!,
      baseUrl: process.env.UPSTASH_BOX_BASE_URL,
      runtime: Runtime.Node,
      agent: {
        model: ClaudeCode.Sonnet_4_5,
        apiKey: process.env.CLAUDE_KEY!,
      },
    });

    const run = await box.agent.run({ prompt: task.prompt });

    // List generated files
    const files = await box.files.list("output");
    const output = await run.result();
    const cost = await run.cost();

    await box.delete();

    return {
      name: task.name,
      output: output.slice(0, 200),
      files: files.map((f) => f.name),
      tokens: cost.tokens,
      durationMs: Date.now() - start,
    };
  }),
);

// Summary
for (const r of results) {
  console.log(`\n=== ${r.name} ===`);
  console.log(`  Files: ${r.files.join(", ")}`);
  console.log(`  Tokens: ${r.tokens}`);
  console.log(`  Duration: ${(r.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Output: ${r.output}...`);
}

import { Box, Runtime, ClaudeCode } from "@upstash/box";

// Multiple turns on the same box — each run builds on the previous context.

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.CLAUDE_KEY!,
  },
});

console.log(`Box: ${box.id}\n`);

// Turn 1: Create a project
console.log("=== Turn 1: Create project ===");
const run1 = await box.agent.run({
  prompt: `Create a simple Express.js REST API at api/ with:
- GET /todos — list all todos
- POST /todos — create a todo
- DELETE /todos/:id — delete a todo
Use an in-memory array. Include package.json.`,
});
console.log(run1.result);

// Turn 2: Add tests
console.log("\n\n=== Turn 2: Add tests ===");
const run2 = await box.agent.run({
  prompt: `Add tests for the API you just created.
Use vitest. Test all three endpoints.
Make sure the tests actually pass — run them.`,
});
console.log(run2.result);

// Turn 3: Add validation
console.log("\n\n=== Turn 3: Add input validation ===");
const run = await box.agent.run({
  prompt: `Add input validation to the POST /todos endpoint:
- title is required, must be a non-empty string
- Return 400 with an error message if invalid
Update the tests to cover validation cases. Run the tests.`,
});
console.log(run.result);
const cost = run.cost;
console.log(`Tokens: ${cost.inputTokens + cost.outputTokens}`);

// Check final project structure
const files = await box.files.list("api");
console.log("\n=== Final files ===");
for (const f of files) {
  console.log(`  ${f.is_dir ? "📁" : "📄"} ${f.name}`);
}

await box.delete();

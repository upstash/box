import { Box, Runtime, ClaudeCode } from "@upstash/box";

// Clone a repo, run a code review, and get a structured report.

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.CLAUDE_KEY!,
  },
  git: {
    token: process.env.GITHUB_TOKEN!,
  },
});

await box.git.clone({ repo: "https://github.com/upstash/context7" });

// Single-shot — get the full review as output
const run = await box.agent.run({
  prompt: `Review this codebase for:
1. Security vulnerabilities (injection, auth issues, secrets in code)
2. Performance problems (N+1 queries, memory leaks, missing indexes)
3. Code quality (dead code, duplicated logic, missing error handling)

For each issue found, provide:
- File path and line number
- Severity (critical / warning / info)
- Description of the problem
- Suggested fix

Format the output as a markdown report.`,
});

const output = await run.result();
const cost = await run.cost();

console.log(output);
console.log(`\n---`);
console.log(`Tokens: ${cost.tokens}`);

// Save the report to the box and download it
await box.files.write({ path: "review.md", content: output });
await box.files.download({ path: "." });

await box.delete();

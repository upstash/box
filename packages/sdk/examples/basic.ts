import { Box, Runtime, ClaudeCode } from "@upstash/box";

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

// Generate context7.md — AI-friendly documentation for the repo
for await (const chunk of box.agent.stream({
  prompt: `Analyze this project and create a file called context7.md with:
- A 2-paragraph introduction (purpose + core functionality)
- All APIs and functions documented with practical code examples
- Sample data, error handling, and expected output in examples
- A 2-paragraph summary (use cases + integration patterns)

Focus on what a developer needs to USE this library, not how it works internally.
Write context7.md to the current directory.`,
})) {
  if (chunk.type === "text-delta") process.stdout.write(chunk.text);
}

// Read the generated file
const context = await box.files.read("context7.md");
console.log(`\nGenerated ${context.length} characters of documentation`);

await box.delete();

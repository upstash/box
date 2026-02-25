import { Box, Runtime, ClaudeCode } from "@upstash/box";

// Clone a repo, upload files, make changes with AI, and open a pull request.

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

console.log(`Box: ${box.id}`);

// Step 1: Clone the repo
await box.git.clone({ repo: "https://github.com/buggyhunter/Next-js-Boilerplate" });
console.log("Repo cloned.");

// Step 2: Write a config file
await box.files.write({ path: "config.json", content: JSON.stringify({
  name: "my-app",
  version: "1.0.0",
  features: { darkMode: true, analytics: false },
}, null, 2) });
console.log("Config file written.");

// Step 3: Write a helper utility
await box.files.write({ path: "src/utils/helpers.ts", content: `
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/\\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
`.trim() });
console.log("Helper utility written.");

// Step 4: Run a shell command
const lsRun = await box.exec("ls -la src/");
console.log("Files in src/:", await lsRun.result());

// Step 5: Ask the agent to make changes
await box.agent.run({
  prompt: `Add a CONTRIBUTING.md file with guidelines for contributing to this project. Also add a LICENSE file with MIT license.`,
});

// Step 6: Ask the agent to refactor something
await box.agent.run({
  prompt: `Look at src/utils/helpers.ts and add JSDoc comments to each function, and add a new function called "truncate" that truncates a string to a given length with "..." suffix.`,
});

// Check what changed
const diff = await box.git.diff();
console.log("\n\n=== Git Diff ===");
console.log(diff.slice(0, 1000));

// Read back the modified file
const helpers = await box.files.read("src/utils/helpers.ts");
console.log("\n=== helpers.ts ===");
console.log(helpers);

// Commit, push, and open a PR
const commit = await box.git.commit({ message: "feat: add config, helpers, contributing guide" });
console.log(`\nCommit: ${commit.sha}`);

await box.git.push();
console.log("Pushed.");

const prUrl = await box.git.createPR({
  title: "feat: add config, helpers, and contributing guide",
  body: "Added config.json, utility helpers, CONTRIBUTING.md, and LICENSE.",
  base: "main",
});
console.log(`PR: ${prUrl}`);

// await box.delete();

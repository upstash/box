/**
 * File upload — upload local files to the sandbox for the agent to work with.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... ANTHROPIC_API_KEY=sk-... npx tsx examples/file-upload.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { Box, ClaudeCode } from "@upstash/box";

// Create a temp file to upload
mkdirSync("/tmp/box-demo", { recursive: true });
writeFileSync(
  "/tmp/box-demo/data.csv",
  `name,age,city
Alice,30,New York
Bob,25,San Francisco
Charlie,35,Chicago
Diana,28,Austin
Eve,32,Seattle`,
);

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
  runtime: "node",
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});

console.log(`Box created: ${box.id}\n`);

// Upload the file
await box.files.upload([
  { path: "/tmp/box-demo/data.csv", destination: "data.csv" },
]);
console.log("File uploaded to sandbox.\n");

// Have the agent process it
const run = await box.agent.run({
  prompt: "Read data.csv in the workspace, analyze it, and create a summary report as report.md with statistics about the data.",
  onStream: (chunk) => process.stdout.write(chunk),
});

// Read the generated report
console.log("\n\nGenerated report:");
console.log(await box.files.read("report.md"));

await box.delete();

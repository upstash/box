/**
 * Structured output — parse agent responses into typed objects using Zod.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=abx_... ANTHROPIC_API_KEY=sk-... npx tsx examples/structured-output.ts
 */
import { z } from "zod";
import { Box, ClaudeCode } from "@buggyhunter/box";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
  runtime: "node",
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});

console.log(`Box created: ${box.id}\n`);

// Define a Zod schema for the expected output
const AnalysisSchema = z.object({
  language: z.string(),
  frameworks: z.array(z.string()),
  fileCount: z.number(),
  entryPoint: z.string(),
  summary: z.string(),
});

// Write a small project to analyze
await box.files.write({
  path: "index.ts",
  content: `import express from "express";
const app = express();
app.get("/health", (req, res) => res.json({ ok: true }));
app.listen(3000);`,
});

await box.files.write({
  path: "package.json",
  content: JSON.stringify({ dependencies: { express: "^4.18.0", typescript: "^5.0.0" } }),
});

// Run with responseSchema — result is typed and validated
const run = await box.agent.run({
  prompt: "Analyze the project in /workspace/home and return a JSON summary",
  responseSchema: AnalysisSchema,
  onStream: (chunk) => process.stdout.write(chunk),
});

const analysis = await run.result();
console.log("\n\nParsed result:");
console.log(`  Language: ${analysis.language}`);
console.log(`  Frameworks: ${analysis.frameworks.join(", ")}`);
console.log(`  Files: ${analysis.fileCount}`);
console.log(`  Entry: ${analysis.entryPoint}`);
console.log(`  Summary: ${analysis.summary}`);

await box.delete();

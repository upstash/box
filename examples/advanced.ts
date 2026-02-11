import { Box, Runtime, ClaudeCode } from "../src/index.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Python,
  agent: {
    model: ClaudeCode.Opus_4_5,
    apiKey: process.env.CLAUDE_KEY!,
  },
});

// Step 1: Ask the agent to create a trim script
const run = await box.run({
  prompt: `Create a Python script at /work/trim.py that:
- Takes an input mp3 file path and output mp3 file path as arguments
- Trims the mp3 to the first 60 seconds
- Uses pydub (install ffmpeg and pydub if needed)
- Example usage: python trim.py /work/input.mp3 /work/processed/output.mp3`,
});

for await (const chunk of run.stream()) {
  process.stdout.write(chunk);
}

// Step 2: Create the output directory
await box.shell("mkdir -p /work/processed");

// Step 3: Process each mp3 file one by one
const localFolder = "./mp3s";
const files = await readdir(localFolder);
const mp3Files = files.filter((f) => f.endsWith(".mp3"));

for (const file of mp3Files) {
  console.log(`Processing ${file}...`);

  // Upload one file at a time
  await box.uploadFiles([
    { path: join(localFolder, file), mountPath: `/work/${file}` },
  ]);

  // Run the trim script
  const trim = await box.shell(
    `python /work/trim.py /work/${file} /work/processed/${file}`,
  );

  const cost = await trim.cost();
  console.log(`  Done — ${cost.computeMs}ms`);
}

// Step 4: Download all processed files
await box.downloadFiles({ path: "/work/processed" });

console.log(`Processed ${mp3Files.length} files → ./processed/`);

await box.delete();

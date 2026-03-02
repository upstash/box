import { Box, Runtime, ClaudeCode } from "@upstash/box";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

// Upload CSV files, process them with Python, download results.

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Python,
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.CLAUDE_KEY!,
  },
});

console.log(`Box: ${box.id}\n`);

// Step 1: Ask the agent to create a data processing script
const run = await box.agent.run({
  prompt: `Create a Python script at process.py that:
- Reads a CSV file from the path given as first argument
- Cleans the data: removes duplicates, trims whitespace, handles missing values
- Generates a summary with: row count, column names, basic stats per numeric column
- Writes the cleaned CSV to the path given as second argument
- Prints the summary as JSON to stdout
- Uses only pandas (install it if needed)

Example: python process.py input.csv output/clean.csv`,
});
const output = run.result;
console.log("Script created.");
console.log(output.slice(0, 300));

// Step 2: Create output directory
await box.exec.command("mkdir -p output");

// Step 3: Upload and process each CSV
const dataDir = "./data";
const files = await readdir(dataDir);
const csvFiles = files.filter((f) => f.endsWith(".csv"));

const summaries = [];

for (const file of csvFiles) {
  console.log(`\nProcessing ${file}...`);

  await box.files.upload([
    { path: join(dataDir, file), destination: file },
  ]);

  const proc = await box.exec.command(
    `python process.py ${file} output/${file}`,
  );

  const procOutput = proc.result;
  const procStatus = await proc.status();

  if (procStatus === "completed") {
    try {
      summaries.push({ file, ...JSON.parse(procOutput) });
    } catch {
      summaries.push({ file, raw: procOutput });
    }
  } else {
    console.error(`  Error processing ${file}`);
  }
}

// Step 4: Download processed files
await box.files.download({ path: "output" });

// Print summaries
console.log("\n=== Summaries ===");
for (const s of summaries) {
  console.log(`${s.file}:`, JSON.stringify(s, null, 2));
}

await box.delete();

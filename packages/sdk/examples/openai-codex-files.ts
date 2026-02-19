import { Box, Runtime, OpenAICodex } from "@buggyhunter/box";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: OpenAICodex.GPT_5_2_Codex,
    apiKey: process.env.OPENAI_API_KEY!,
  },
});

// 1. Write a file to the box
console.log("--- Writing file ---");
await box.files.write({
  path: "hello.ts",
  content: `
export function greet(name: string): string {
  return "Hello, " + name;
}

console.log(greet("World"));
`,
});

const content = await box.files.read("hello.ts");
console.log("File content:\n", content);

// 2. Ask the agent to modify the file
console.log("\n--- Asking agent to modify the file ---");
const run = await box.agent.run({
  prompt: `Read hello.ts and make these changes:
1. Add a farewell() function that says "Goodbye, <name>!"
2. Change greet() to use template literals instead of string concatenation
3. Call both functions at the bottom`,
  onStream: (chunk) => process.stdout.write(chunk),
});

const cost = await run.cost();
console.log(`\n\nTokens: ${cost.tokens} | Status: ${await run.status()}`);

// 3. Read the modified file
console.log("\n--- Modified file ---");
const modified = await box.files.read("hello.ts");
console.log(modified);

// 4. Run it
console.log("--- Running ---");
const shellRun = await box.exec("npx tsx /workspace/home/hello.ts");
console.log("Output:", await shellRun.result());

// await box.delete();

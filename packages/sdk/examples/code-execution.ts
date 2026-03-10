/**
 * Code Execution API — run inline JS/TS/Python scripts inside a Box.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=... bun run code-execution.ts
 */
import { Box } from "@upstash/box";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: "node",
});

// 1. Run JavaScript
console.log("=== JavaScript ===");
const jsRun = await box.exec.code({
  code: `
    const data = [1, 2, 3, 4, 5];
    const sum = data.reduce((a, b) => a + b, 0);
    const avg = sum / data.length;
    console.log(JSON.stringify({ sum, avg, count: data.length }));
  `,
  lang: "js",
});
console.log("Output:", jsRun.result.trim());
console.log("Exit code:", jsRun.exitCode);
console.log();

// 2. Run TypeScript
console.log("=== TypeScript ===");
const tsRun = await box.exec.code({
  code: `
    interface User {
      name: string;
      age: number;
    }

    const users: User[] = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];

    const oldest = users.reduce((prev, curr) => prev.age > curr.age ? prev : curr);
    console.log(\`Oldest user: \${oldest.name} (age \${oldest.age})\`);
  `,
  lang: "ts",
});
console.log("Output:", tsRun.result.trim());
console.log("Exit code:", tsRun.exitCode);
console.log();

// 3. Run Python (requires python runtime box — will fail on node runtime)
console.log("=== Python (expected to fail on node runtime) ===");
const pyRun = await box.exec.code({
  code: `
import json
data = [1, 2, 3, 4, 5]
result = {"sum": sum(data), "avg": sum(data)/len(data)}
print(json.dumps(result))
  `,
  lang: "python",
});
console.log("Output:", pyRun.result.trim() || "(error)");
console.log("Exit code:", pyRun.exitCode);
console.log();

// 4. Error handling
console.log("=== Error Handling ===");
const errRun = await box.exec.code({
  code: `throw new Error("something went wrong")`,
  lang: "js",
});
console.log("Exit code:", errRun.exitCode);
console.log("Error:", errRun.result.split("\n").slice(0, 3).join("\n"));
console.log();

// Cleanup
await box.delete();
console.log("Box deleted.");

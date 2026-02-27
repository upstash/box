/**
 * Code Execution API — run inline JS/TS/Python scripts inside a Box.
 *
 * Usage:
 *   UPSTASH_BOX_API_KEY=... bun run code-execution.ts
 */
import { Box, Runtime } from "@upstash/box";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
});

// 1. Run JavaScript
console.log("=== JavaScript ===");
const jsResult = await box.code({
  code: `
    const data = [1, 2, 3, 4, 5];
    const sum = data.reduce((a, b) => a + b, 0);
    const avg = sum / data.length;
    console.log(JSON.stringify({ sum, avg, count: data.length }));
  `,
  language: "js",
});
console.log("Output:", jsResult.output.trim());
console.log("Exit code:", jsResult.exit_code);
console.log();

// 2. Run TypeScript
console.log("=== TypeScript ===");
const tsResult = await box.code({
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
  language: "ts",
});
console.log("Output:", tsResult.output.trim());
console.log("Exit code:", tsResult.exit_code);
console.log();

// 3. Run Python (requires python runtime box — will fail on node runtime)
console.log("=== Python (expected to fail on node runtime) ===");
const pyResult = await box.code({
  code: `
import json
data = [1, 2, 3, 4, 5]
result = {"sum": sum(data), "avg": sum(data)/len(data)}
print(json.dumps(result))
  `,
  language: "python",
});
console.log("Output:", pyResult.output?.trim() || pyResult.error?.split("\n")[0]);
console.log("Exit code:", pyResult.exit_code);
console.log();

// 4. Error handling
console.log("=== Error Handling ===");
const errResult = await box.code({
  code: `throw new Error("something went wrong")`,
  language: "js",
});
console.log("Exit code:", errResult.exit_code);
console.log("Error:", errResult.error?.split("\n").slice(0, 3).join("\n"));
console.log();

// Cleanup
await box.delete();
console.log("Box deleted.");

---
title: "Structured Output"
description: "Use Zod schemas to get typed, validated output from Box runs."
---

When you need predictable JSON from an agent, structured output is the safest option. You define a Zod schema, pass it to `responseSchema`, and the SDK validates the model output before returning it as a typed object.

**Problem**
Free-form text is hard to parse and can break downstream automation. You want data that is guaranteed to match a schema.

**Solution**
Use `responseSchema` with a Zod schema. The SDK converts it to JSON Schema, requests structured output, and parses the final result into strongly typed data.

<Steps>
<Step>
### Define the schema and create a box
```ts filename="structured-output.ts"
import { Box, Agent, ClaudeCode } from "@upstash/box";
import { z } from "zod";

const reviewSchema = z.object({
  title: z.string(),
  risk: z.enum(["low", "medium", "high"]),
  summary: z.string(),
  files: z.array(z.string()),
});

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});
```
</Step>
<Step>
### Run the prompt with `responseSchema`
```ts filename="structured-output.ts"
const run = await box.agent.run({
  prompt: "Summarize this diff and list the files changed: ./",
  responseSchema: reviewSchema,
});

console.log(run.result.title);
console.log(run.result.risk);
console.log(run.result.files);
```
</Step>
<Step>
### Clean up
```ts filename="structured-output.ts"
await box.delete();
```
</Step>
</Steps>

Expected output (shape):
```
{
  "title": "Refactor auth middleware",
  "risk": "medium",
  "summary": "...",
  "files": ["src/auth.ts", "src/server.ts"]
}
```

**Notes and tips**
- The SDK throws a `BoxError` if the output cannot be parsed into the schema.
- Schema validation happens after the run completes, so you still want to craft prompts that describe the expected JSON clearly.
- If you need streaming *and* structured output, you can run a non-streaming request to produce validated results, and a separate streaming run for live progress.

**Troubleshooting**
If the run fails with a schema parsing error, log the raw output and compare it with your schema field names and types. Models often return extra commentary when the prompt is vague. Make the prompt strict by telling the model to respond with JSON only, and include an example object that matches the schema. When the response is still inconsistent, narrow the schema to the minimum required fields and expand it gradually once the output is stable.

---
title: "Ephemeral Processing"
description: "Use EphemeralBox for short-lived tasks like file processing and quick execs."
---

Ephemeral boxes are ideal when you need a fast, disposable environment. They are created immediately and auto-delete after a TTL, making them perfect for one-off scripts, transforms, or batch processing.

**Problem**
You need a sandboxed runtime for a short task, but a full Box feels heavy and you do not need an AI agent or git.

**Solution**
Use `EphemeralBox`. It provides the same exec and file APIs, but skips agent and git features to reduce overhead.

<Steps>
<Step>
### Create an ephemeral box
```ts filename="ephemeral-processing.ts"
import { EphemeralBox } from "@upstash/box";

const box = await EphemeralBox.create({
  runtime: "python",
  ttl: 1800,
  env: { MODE: "fast" },
});
```
</Step>
<Step>
### Upload data and process it
```ts filename="ephemeral-processing.ts"
await box.files.upload([
  { path: "./data/input.csv", destination: "input.csv" },
]);

const run = await box.exec.command(
  "python -c 'import pandas as pd; df=pd.read_csv(" +
    ""input.csv"" +
    "); print(df.head(2).to_string(index=False))'"
);

console.log(run.result);
```
</Step>
<Step>
### Download outputs and delete
```ts filename="ephemeral-processing.ts"
await box.files.download({ folder: "." });
await box.delete();
```
</Step>
</Steps>

**Why this matters**
Ephemeral boxes provide the same sandboxing guarantees but avoid the startup cost of agent configuration and polling. If your application spins up many short-lived jobs, this is the most cost-efficient approach.

**When to use EphemeralBox**
Choose EphemeralBox for ETL-style tasks, quick builds, or any workflow where you only need exec and files. Because ephemeral boxes skip agent setup and polling, they start faster and are simpler to clean up. If you later need an agent or git operations, switch to a full Box and keep the same code paths for exec and files. This makes it easy to prototype on EphemeralBox and scale up to a full-featured Box when the workflow grows.

That migration path is smooth.

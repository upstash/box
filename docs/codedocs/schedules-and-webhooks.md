---
title: "Schedules And Webhooks"
description: "Run prompts or commands on cron schedules and deliver results via webhooks."
---

Schedules let you run a Box command or agent prompt on a cron cadence without keeping a process alive. Webhooks let you fire-and-forget a run and receive the result asynchronously. Together, they enable background automation for maintenance tasks, reporting, and recurring analysis.

**Why this concept exists**
AI-assisted workflows are often periodic. You may want to re-run tests nightly, regenerate documentation weekly, or run a prompt against new data as it arrives. Schedules and webhooks let you do that without manually maintaining a worker or cron job in your own infrastructure.

**How it relates to other concepts**
- Schedules create **runs** inside a Box.
- Schedule and webhook results can be consumed alongside **files** and **git** operations.
- Schedules and webhooks are often paired with **snapshots** to manage state.

```mermaid
flowchart TD
  A[Create schedule] --> B[Box API stores cron]
  B --> C[Run fires on schedule]
  C --> D[Exec or Agent run]
  D --> E[Webhook POST (optional)]
  D --> F[Run record available]
```

**How it works internally**
Schedules are thin wrappers in `packages/sdk/src/client.ts`. `box.schedule.exec()` posts a payload with `type: "exec"`, a `cron` string, and a command array. `box.schedule.agent()` posts `type: "prompt"` and includes prompt, optional model override, and agent options. The SDK resolves `folder` using the same `cwd` logic used by file and exec operations.

Webhook runs are triggered by `RunOptions.webhook` and handled in `_executeWebhookRun()`. Instead of streaming output, the SDK sends the prompt plus webhook config to the backend. The API returns immediately with a run ID, and later posts a `WebhookPayload` to your URL when the run completes.

**Basic usage (scheduled exec + scheduled prompt)**
```ts filename="schedule-basic.ts"
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});

const execSchedule = await box.schedule.exec({
  cron: "* * * * *",
  command: ["bash", "-c", "date >> /workspace/home/cron.log"],
});

const agentSchedule = await box.schedule.agent({
  cron: "0 9 * * *",
  prompt: "Summarize yesterday's logs in /workspace/home/cron.log",
});

console.log(execSchedule.id, agentSchedule.id);
```

**Advanced / edge-case usage (webhook run)**
```ts filename="webhook-run.ts"
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});

const run = await box.agent.run({
  prompt: "Create a daily release notes summary for the repo",
  webhook: { url: "https://example.com/hooks/box" },
});

console.log("Webhook run accepted:", run.id);
```

<Callout type="warn">
Cron schedules run in UTC and do not inherit your local timezone. If your webhook endpoint is not reachable from the public internet, the run will complete but delivery will fail silently on your side. Always validate incoming webhook payloads and be explicit about timeouts and auth.
</Callout>

<Accordions>
<Accordion title="Schedules vs External Cron">
Schedules are ideal when the job is tightly coupled to a Box environment or when you want to avoid managing infrastructure. External cron gives you more control over retries, concurrency, and alerting. If your workload requires strict guarantees or complex scheduling, you may prefer an external scheduler that triggers Box runs on demand. If the workflow is simple and self-contained, Box schedules reduce operational overhead.
</Accordion>
<Accordion title="Webhook Delivery vs Polling">
Webhooks provide low-latency delivery without holding open a client connection. This works well for serverless systems but requires you to host and secure a public endpoint. Polling run status avoids webhook complexity but increases latency and API calls. Choose webhooks when you can receive HTTP callbacks reliably; choose polling when your environment cannot expose an endpoint.
</Accordion>
<Accordion title="Folder Resolution in Scheduled Runs">
Scheduled runs default to the Box `cwd` at the time you create the schedule. If you later call `cd()`, the schedule does not automatically follow. Use the `folder` option in schedule calls to lock the run to a known path. This prevents surprises when your code changes the cwd after scheduling jobs.
</Accordion>
</Accordions>

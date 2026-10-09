---
title: "Scheduled Jobs"
description: "Set up cron-based exec and agent jobs with optional webhooks."
---

This guide shows how to set up recurring jobs inside a Box. You can run shell commands, agent prompts, or a mix of both, and optionally receive results via a webhook.

**Problem**
You want to run maintenance or analysis tasks on a schedule without managing your own cron infrastructure.

**Solution**
Use the Box schedule API to create `exec` or `agent` schedules with cron expressions, then query or pause them as needed.

<Steps>
<Step>
### Create a box and schedule an exec job
```ts filename="scheduled-jobs.ts"
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});

const execSchedule = await box.schedule.exec({
  cron: "*/5 * * * *",
  command: ["bash", "-c", "date >> /workspace/home/cron.log"],
});

console.log(execSchedule.id);
```
</Step>
<Step>
### Add a daily agent summary
```ts filename="scheduled-jobs.ts"
const agentSchedule = await box.schedule.agent({
  cron: "0 9 * * *",
  prompt: "Summarize /workspace/home/cron.log in bullet points.",
  webhookUrl: "https://example.com/hooks/box",
});

console.log(agentSchedule.id);
```
</Step>
<Step>
### Pause or delete schedules
```ts filename="scheduled-jobs.ts"
const schedules = await box.schedule.list();
await box.schedule.pause(schedules[0].id);
await box.schedule.resume(schedules[0].id);
await box.schedule.delete(execSchedule.id);
```
</Step>
</Steps>

**Operational tips**
- Cron expressions are interpreted in UTC, so convert local times carefully.
- If you change directories with `box.cd()`, schedules you created earlier will not update their folder path.
- For high-frequency tasks, consider batch work in a single run to avoid excessive scheduling overhead.

If you need a verified delivery pipeline, pair schedules with a webhook endpoint that records the `run_id` and `status` for auditing. This makes it easy to build dashboards or alerting when runs fail. You can also use `box.schedule.list()` and `box.schedule.get()` to reconcile the desired schedule set with the actual one when deploying updates.

Treat schedules as infrastructure.

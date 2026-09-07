import { Box } from "@upstash/box";
import { announceBox, resolveBoxId } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, requireToken, timeoutMs, type GlobalFlags } from "../core/io.js";

export type ScheduleFlags = GlobalFlags & {
  cron?: string;
  folder?: string;
  model?: string;
  timeout?: string;
  webhookUrl?: string;
  prompt?: string;
};

async function open(flags: ScheduleFlags): Promise<Box> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);
  return Box.get(resolved.id, { apiKey: requireToken(flags.token) });
}

/** One line per schedule, id first so the other verbs have something to take. */
function line(schedule: {
  id: string;
  type: string;
  cron: string;
  status: string;
  command?: string[];
  prompt?: string;
}): string {
  const what = schedule.command ? schedule.command.join(" ") : (schedule.prompt ?? "");
  return `${schedule.id}\t${schedule.status}\t${schedule.type}\t${schedule.cron}\t${what}`;
}

/**
 * Schedule a shell command on a cron.
 *
 * The command goes after `--`, same as `box exec`, so its own flags are not
 * read as this command's.
 * @param command - the argv to run in the box.
 * @param flags - the merged flags; --cron is required.
 */
export async function scheduleExecCommand(command: string[], flags: ScheduleFlags): Promise<void> {
  if (!flags.cron) throw new CliError("--cron is required, e.g. --cron '0 9 * * *'");
  if (command.length === 0) {
    throw new CliError("Nothing to schedule. Put the command after --");
  }

  const box = await open(flags);
  const schedule = await box.schedule.exec({
    cron: flags.cron,
    command,
    ...(flags.folder === undefined ? {} : { folder: flags.folder }),
    ...(flags.webhookUrl === undefined ? {} : { webhookUrl: flags.webhookUrl }),
  });

  emit(schedule, [schedule.id], flags);
}

/**
 * Schedule an agent prompt on a cron.
 * @param prompt - the prompt words.
 * @param flags - the merged flags; --cron is required.
 */
export async function scheduleAgentCommand(prompt: string[], flags: ScheduleFlags): Promise<void> {
  if (!flags.cron) throw new CliError("--cron is required, e.g. --cron '0 9 * * *'");
  const text = prompt.join(" ").trim();
  if (!text) throw new CliError("Nothing to schedule. Give the agent a prompt.");

  const box = await open(flags);
  const timeout = timeoutMs(flags.timeout);
  const schedule = await box.schedule.agent({
    cron: flags.cron,
    prompt: text,
    ...(flags.folder === undefined ? {} : { folder: flags.folder }),
    ...(flags.model === undefined ? {} : { model: flags.model }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(flags.webhookUrl === undefined ? {} : { webhookUrl: flags.webhookUrl }),
  });

  emit(schedule, [schedule.id], flags);
}

/**
 * List the box's schedules.
 * @param flags - the merged flags.
 */
export async function scheduleListCommand(flags: ScheduleFlags): Promise<void> {
  const box = await open(flags);
  const schedules = await box.schedule.list();
  emit(schedules, schedules.length === 0 ? ["No schedules."] : schedules.map(line), flags);
}

/**
 * Show one schedule, including its run counts.
 * @param id - the schedule id.
 * @param flags - the merged flags.
 */
export async function scheduleGetCommand(id: string, flags: ScheduleFlags): Promise<void> {
  const box = await open(flags);
  const schedule = await box.schedule.get(id);
  emit(
    schedule,
    [line(schedule), `runs: ${schedule.total_runs}, failures: ${schedule.total_failures}`],
    flags,
  );
}

/**
 * Change a schedule in place.
 *
 * Only the fields named are sent, so an update that changes the cron leaves the
 * command and the webhook alone.
 * @param id - the schedule id.
 * @param command - a replacement command, when given after `--`.
 * @param flags - the merged flags.
 */
export async function scheduleUpdateCommand(
  id: string,
  command: string[],
  flags: ScheduleFlags,
): Promise<void> {
  const timeout = timeoutMs(flags.timeout, { allowZero: true });
  const changes = {
    ...(flags.cron === undefined ? {} : { cron: flags.cron }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(command.length === 0 ? {} : { command }),
    ...(flags.prompt === undefined ? {} : { prompt: flags.prompt }),
    ...(flags.folder === undefined ? {} : { folder: flags.folder }),
    ...(flags.model === undefined ? {} : { model: flags.model }),
    ...(flags.webhookUrl === undefined ? {} : { webhookUrl: flags.webhookUrl }),
  };
  if (Object.keys(changes).length === 0) {
    throw new CliError(
      "Nothing to update. Pass --cron, --prompt, --folder, --model, --timeout, --webhook-url, or a command after --",
    );
  }

  const box = await open(flags);
  const schedule = await box.schedule.update(id, changes);
  emit(schedule, [line(schedule)], flags);
}

/**
 * Pause a schedule without deleting it.
 * @param id - the schedule id.
 * @param flags - the merged flags.
 */
export async function schedulePauseCommand(id: string, flags: ScheduleFlags): Promise<void> {
  const box = await open(flags);
  await box.schedule.pause(id);
  emit({ id, status: "paused" }, [`Paused ${id}`], flags);
}

/**
 * Resume a paused schedule.
 * @param id - the schedule id.
 * @param flags - the merged flags.
 */
export async function scheduleResumeCommand(id: string, flags: ScheduleFlags): Promise<void> {
  const box = await open(flags);
  await box.schedule.resume(id);
  emit({ id, status: "active" }, [`Resumed ${id}`], flags);
}

/**
 * Delete a schedule.
 * @param id - the schedule id.
 * @param flags - the merged flags.
 */
export async function scheduleDeleteCommand(id: string, flags: ScheduleFlags): Promise<void> {
  const box = await open(flags);
  await box.schedule.delete(id);
  emit({ id, deleted: true }, [`Deleted ${id}`], flags);
}

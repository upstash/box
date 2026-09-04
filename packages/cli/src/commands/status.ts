import { Box } from "@upstash/box";
import { announceBox, findBoxFile, resolveBoxId } from "../core/box-ref.js";
import { emit, requireToken, type GlobalFlags } from "../core/io.js";

/**
 * Report which box is selected, where that came from, and what it is doing.
 *
 * Also the first exercise of the resolution order, the stderr banner and the
 * exit-code mapping, so those are proven by a real command before anything
 * larger is built on them.
 * @param flags - resolved global flags.
 */
export async function statusCommand(flags: GlobalFlags): Promise<void> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);

  const apiKey = requireToken(flags.token);
  const box = await Box.get(resolved.id, { apiKey });
  const { status } = await box.getStatus();

  const shadowed =
    resolved.source === "env" && findBoxFile(process.cwd()) !== undefined
      ? findBoxFile(process.cwd())
      : undefined;

  emit(
    {
      id: resolved.id,
      status,
      source: resolved.source,
      ...(resolved.path === undefined ? {} : { source_path: resolved.path }),
      ...(shadowed === undefined ? {} : { shadowed_box_file: shadowed }),
    },
    [
      `${resolved.id} is ${status}`,
      ...(status === "paused" ? ["It resumes automatically on the next command."] : []),
      // BOX_ID winning over a checked-out .box is deliberate, and is the case
      // where someone is most likely to think they are talking to another box.
    ],
    flags,
  );
}

/**
 * List the box's runs, most recent first.
 *
 * The REPL has had this since the beginning; without it a non-interactive
 * caller can see that a run happened but not which one, so it has no id to
 * cancel or to read logs for.
 * @param flags - resolved global flags.
 */
export async function statusRunsCommand(flags: GlobalFlags): Promise<void> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);

  const box = await Box.get(resolved.id, { apiKey: requireToken(flags.token) });
  const runs = await box.listRuns();

  emit(
    runs,
    runs.length === 0
      ? ["No runs yet."]
      : runs.map(
          (run) =>
            `${run.id}\t${run.type}\t${run.status ?? ""}\t${Math.round(run.duration_ms / 1000)}s\t$${run.cost_usd.toFixed(4)}`,
        ),
    flags,
  );
}

/**
 * Print the box's log lines.
 * @param flags - resolved global flags, plus paging.
 */
export async function statusLogsCommand(
  flags: GlobalFlags & { limit?: string; offset?: string },
): Promise<void> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);

  const box = await Box.get(resolved.id, { apiKey: requireToken(flags.token) });
  const logs = await box.logs({
    ...(flags.limit === undefined ? {} : { limit: Number(flags.limit) }),
    ...(flags.offset === undefined ? {} : { offset: Number(flags.offset) }),
  });

  emit(
    logs,
    logs.length === 0
      ? ["No logs."]
      : logs.map(
          (entry) =>
            `${new Date(entry.timestamp * 1000).toISOString()}\t${entry.level}\t${entry.source}\t${entry.message}`,
        ),
    flags,
  );
}

/**
 * Cancel a run by id.
 *
 * An agent that starts a long run has no other way to stop it: the object with
 * `.cancel()` on it lives in the process that started the run, which has
 * usually exited by the time anyone wants it stopped.
 * @param runId - the run to cancel, from `box status runs`.
 * @param flags - resolved global flags.
 */
export async function cancelCommand(runId: string, flags: GlobalFlags): Promise<void> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);

  const box = await Box.get(resolved.id, { apiKey: requireToken(flags.token) });
  await box.cancelRun(runId);

  emit({ run_id: runId, cancelled: true }, [`Cancelled ${runId}`], flags);
}

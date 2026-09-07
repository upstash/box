import { Box } from "@upstash/box";
import type { BoxData } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { CliError } from "../core/errors.js";
import { emit, type GlobalFlags } from "../core/io.js";

export type GetFlags = GlobalFlags;

/** Fields worth printing in the text form, in the order a reader wants them. */
const SUMMARY: [keyof BoxData, string][] = [
  ["name", "name"],
  ["status", "status"],
  ["runtime", "runtime"],
  ["size", "size"],
  ["model", "model"],
  ["clone_repo", "repo"],
];

/**
 * Render a box timestamp.
 *
 * The API sends epoch seconds, which is not a date to anyone reading it.
 * @param value - the timestamp as given.
 * @returns an ISO string, or undefined when there is nothing to show.
 */
export function formatCreated(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  // Seconds below the year 2286; anything larger is already milliseconds.
  const ms = value < 1e12 ? value * 1000 : value;
  return new Date(ms).toISOString();
}

/**
 * Show what is known about one box.
 *
 * The per-box endpoint the SDK exposes is the status one, so the detail comes
 * from the list — filtered here rather than by the caller.
 * @param boxId - the box to describe.
 * @param flags - global flags.
 */
export async function getCommand(boxId: string, flags: GetFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const boxes = await Box.list({ apiKey });
  const found = boxes.find((entry) => entry.id === boxId);
  if (!found) {
    throw new CliError(`No box named ${boxId}. Run \`box list\` to see the boxes you have.`);
  }

  // The live state is worth a second call: a box pauses on its own, so the
  // listing can be stale by the time it is read.
  const status = await Box.get(boxId, { apiKey })
    .then(async (box) => (await box.getStatus()).status)
    .catch(() => undefined);
  const data = {
    ...found,
    ...(status === undefined ? {} : { status: status as BoxData["status"] }),
  };

  const lines = [`${data.id}`];
  for (const [key, label] of SUMMARY) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== "") {
      lines.push(`  ${label}: ${String(value)}`);
    }
  }
  const created = formatCreated(data.created_at);
  if (created) lines.push(`  created: ${created}`);
  if (data.labels?.length) lines.push(`  labels: ${data.labels.join(", ")}`);
  if (data.keep_alive) lines.push("  keep-alive: yes");
  emit(data, lines, flags);
}

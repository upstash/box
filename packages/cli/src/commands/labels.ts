import { Box } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { emit, note, type GlobalFlags } from "../core/io.js";

type LabelFlags = GlobalFlags;

export async function labelAddCommand(
  boxId: string,
  label: string,
  flags: LabelFlags,
): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const box = await Box.get(boxId, { apiKey });
  const labels = await box.labels.add(label);
  emit(labels, `Added "${label}". Labels: ${labels.join(", ") || "(none)"}`, flags);
}

export async function labelRemoveCommand(
  boxId: string,
  label: string,
  flags: LabelFlags,
): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const box = await Box.get(boxId, { apiKey });
  const labels = await box.labels.remove(label);
  emit(labels, `Removed "${label}". Labels: ${labels.join(", ") || "(none)"}`, flags);
}

export async function labelListCommand(boxId: string, flags: LabelFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const box = await Box.get(boxId, { apiKey });
  const labels = await box.labels.list();
  // Same shape as `box public-url`: the note is for a reader, so it goes to
  // stderr and leaves stdout holding only data.
  if (labels.length === 0 && !flags.json) note("No labels.");
  emit(labels, labels, flags);
}

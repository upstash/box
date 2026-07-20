import { Box } from "@upstash/box";
import { resolveToken } from "../auth.js";

interface LabelFlags {
  token?: string;
}

export async function labelAddCommand(
  boxId: string,
  label: string,
  flags: LabelFlags,
): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const box = await Box.get(boxId, { apiKey });
  const labels = await box.labels.add(label);
  console.log(`Added "${label}". Labels: ${labels.join(", ") || "(none)"}`);
}

export async function labelRemoveCommand(
  boxId: string,
  label: string,
  flags: LabelFlags,
): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const box = await Box.get(boxId, { apiKey });
  const labels = await box.labels.remove(label);
  console.log(`Removed "${label}". Labels: ${labels.join(", ") || "(none)"}`);
}

export async function labelListCommand(boxId: string, flags: LabelFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const box = await Box.get(boxId, { apiKey });
  const labels = await box.labels.list();
  if (labels.length === 0) {
    console.log("No labels.");
    return;
  }
  for (const label of labels) {
    console.log(label);
  }
}

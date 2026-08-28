import { Box } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { emit, note, type GlobalFlags } from "../core/io.js";
import { interactiveSelect } from "../utils/interactive-select.js";
import { dim } from "../utils/ansi.js";
import { CliError } from "../core/errors.js";

type SnapshotFlags = GlobalFlags & {
  name?: string;
};

export async function snapshotCommand(
  boxId: string | undefined,
  flags: SnapshotFlags,
): Promise<void> {
  const apiKey = resolveToken(flags.token);

  let targetId = boxId;

  // If no box ID provided, pick interactively or fall back to most recent
  if (!targetId) {
    const boxes = await Box.list({ apiKey });
    const active = boxes.filter((b) => b.status !== "deleted");
    if (active.length === 0) {
      throw new CliError("No boxes found.");
    }

    if (process.stdin.isTTY && active.length > 1) {
      const items = active.slice(0, 10);
      const idWidth = Math.max(...items.map((b) => b.id.length));
      const statusWidth = Math.max(...items.map((b) => b.status.length));

      const selected = await interactiveSelect({
        prompt: "Select a box to snapshot:",
        items: items.map((b) => ({
          label: b.id.padEnd(idWidth),
          value: b.id,
          description: `${b.status.padEnd(statusWidth)}  ${b.model ?? ""}`,
        })),
      });

      if (!selected) {
        note(dim("Aborted."));
        return;
      }
      targetId = selected;
    } else {
      note("Only one box found, using it...");
      targetId = active[0]!.id;
    }
  }

  const snapshotName = flags.name ?? `snapshot-${Date.now()}`;
  note(`Creating snapshot of box ${targetId}...`);
  const box = await Box.get(targetId, { apiKey });
  const snapshot = await box.snapshot({ name: snapshotName });
  emit(snapshot, `Snapshot created: ${snapshot.id} (${snapshot.name})`, flags);
}

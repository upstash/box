import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Snapshot subcommands: create (the default), list, delete.
 *
 * A bare `/snapshot` keeps its original meaning — take one now — so the added
 * subcommands do not change what an existing muscle-memory call does.
 */
export async function* handleSnapshot(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0];

  if (sub === "list") {
    const snapshots = await box.listSnapshots();
    if (snapshots.length === 0) {
      yield { type: "log", message: "No snapshots." };
      return;
    }
    for (const snapshot of snapshots) {
      yield {
        type: "log",
        message: `${snapshot.id}\t${snapshot.name}\t${snapshot.status}\t${snapshot.size_bytes} bytes`,
      };
    }
    return;
  }

  if (sub === "delete") {
    const id = parts[1];
    if (!id) {
      yield { type: "log", message: "Usage: snapshot delete <snapshot-id>" };
      return;
    }
    await box.deleteSnapshot(id);
    yield { type: "log", message: `Deleted snapshot ${id}` };
    return;
  }

  // `create` is advertised as a subcommand, so strip it; without this
  // `snapshot create release` names the snapshot "create release".
  const rest = args.trim();
  const withoutVerb = rest === "create" ? "" : rest.replace(/^create\s+/, "");
  const name = withoutVerb || `snapshot-${Date.now()}`;
  const snapshot = await box.snapshot({ name });
  yield { type: "log", message: `Snapshot created: ${snapshot.id} (${snapshot.name})` };
}

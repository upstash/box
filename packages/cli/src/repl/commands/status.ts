import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Report what the box is doing: state, recent runs, and recent logs.
 *
 * These three answer the questions asked when something looks stuck — is the
 * box even awake, did the last run finish, and what did it say — which
 * otherwise means leaving the REPL for the console.
 */
export async function* handleStatus(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0];

  if (sub === "runs") {
    const runs = await box.listRuns();
    if (runs.length === 0) {
      yield { type: "log", message: "No runs yet." };
      return;
    }
    // listRuns comes back newest-first, so the head is the recent end.
    for (const run of runs.slice(0, 10)) {
      yield { type: "log", message: `${run.id}\t${run.status}` };
    }
    return;
  }

  if (sub === "logs") {
    // Newest last, so the tail reads in the order things happened.
    // A given limit is checked rather than coerced: `status logs nope` used to
    // become 20 silently, and a negative one reached the API unchanged.
    let limit = 20;
    if (parts[1] !== undefined) {
      const asked = Number(parts[1]);
      if (!Number.isInteger(asked) || asked < 1) {
        yield { type: "log", message: "Usage: status logs [count]" };
        return;
      }
      limit = asked;
    }
    const logs = await box.logs({ limit });
    if (logs.length === 0) {
      yield { type: "log", message: "No logs." };
      return;
    }
    for (const entry of logs) {
      const when = new Date(entry.timestamp * 1000).toISOString();
      yield { type: "log", message: `${when} [${entry.level}] ${entry.source}: ${entry.message}` };
    }
    return;
  }

  const { status } = await box.getStatus();
  yield { type: "log", message: `${box.id} is ${status}` };
  if (status === "paused") {
    // Any box call resumes it, so this is information rather than an error.
    yield { type: "log", message: "It resumes automatically on the next command." };
  }
}

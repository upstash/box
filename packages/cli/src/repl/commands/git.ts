import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Handle git subcommands: clone, diff, create-pr.
 */
export async function* handleGit(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const parts = args.split(/\s+/);
  const sub = parts[0];

  switch (sub) {
    case "clone": {
      const repo = parts[1];
      const branch = parts[2];
      if (!repo) {
        yield { type: "log", message: "Usage: git clone <repo> [branch]" };
        return;
      }
      await box.git.clone({ repo, branch });
      yield { type: "log", message: `Cloned ${repo}` };
      break;
    }
    case "diff": {
      const diff = await box.git.diff();
      yield { type: "log", message: diff || "(no changes)" };
      break;
    }
    case "create-pr": {
      const title = parts.slice(1).join(" ");
      if (!title) {
        yield { type: "log", message: "Usage: git create-pr <title>" };
        return;
      }
      const pr = await box.git.createPR({ title });
      yield { type: "log", message: `PR #${pr.number}: ${pr.url}` };
      break;
    }
    case "exec": {
      const execArgs = parts.slice(1);
      if (execArgs.length === 0) {
        yield { type: "log", message: "Usage: git exec <args...>" };
        return;
      }
      const result = await box.git.exec({ args: execArgs });
      yield { type: "log", message: result.output || "(no output)" };
      break;
    }
    case "checkout": {
      const branch = parts[1];
      if (!branch) {
        yield { type: "log", message: "Usage: git checkout <branch>" };
        return;
      }
      await box.git.checkout({ branch });
      yield { type: "log", message: `Switched to branch ${branch}` };
      break;
    }
    default:
      yield { type: "log", message: "Usage: git <clone|diff|create-pr|exec|checkout> [args...]" };
  }
}

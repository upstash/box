import type { Box } from "@upstash/box";
import type { REPLHooks } from "../repl-client.js";

/**
 * Handle git subcommands: clone, diff, create-pr.
 */
export async function handleGit(box: Box, args: string, hooks: REPLHooks): Promise<void> {
  const parts = args.split(/\s+/);
  const sub = parts[0];

  switch (sub) {
    case "clone": {
      const repo = parts[1];
      const branch = parts[2];
      if (!repo) {
        hooks.onLog("Usage: git clone <repo> [branch]");
        return;
      }
      await box.git.clone({ repo, branch });
      hooks.onLog(`Cloned ${repo}`);
      break;
    }
    case "diff": {
      const diff = await box.git.diff();
      hooks.onLog(diff || "(no changes)");
      break;
    }
    case "create-pr": {
      const title = parts.slice(1).join(" ");
      if (!title) {
        hooks.onLog("Usage: git create-pr <title>");
        return;
      }
      const pr = await box.git.createPR({ title });
      hooks.onLog(`PR #${pr.number}: ${pr.url}`);
      break;
    }
    default:
      hooks.onLog("Usage: git <clone|diff|create-pr> [args...]");
  }
}

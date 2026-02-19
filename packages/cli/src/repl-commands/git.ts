import type { Box } from "@buggyhunter/box";

/**
 * Handle git subcommands: clone, diff, create-pr.
 */
export async function handleGit(box: Box, args: string): Promise<void> {
  const parts = args.split(/\s+/);
  const sub = parts[0];

  switch (sub) {
    case "clone": {
      const repo = parts[1];
      const branch = parts[2];
      if (!repo) {
        console.log("Usage: git clone <repo> [branch]");
        return;
      }
      await box.git.clone({ repo, branch });
      console.log(`Cloned ${repo}`);
      break;
    }
    case "diff": {
      const diff = await box.git.diff();
      console.log(diff || "(no changes)");
      break;
    }
    case "create-pr": {
      const title = parts.slice(1).join(" ");
      if (!title) {
        console.log("Usage: git create-pr <title>");
        return;
      }
      const pr = await box.git.createPR({ title });
      console.log(`PR #${pr.number}: ${pr.url}`);
      break;
    }
    default:
      console.log("Usage: git <clone|diff|create-pr> [args...]");
  }
}

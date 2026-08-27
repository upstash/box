import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";
import { isInsideRepo, notARepoMessage } from "../../core/git-repo.js";
import { readFlagValue } from "./args.js";

/**
 * Explain empty git output, which means either a clean tree or no repository.
 * @param box - the box at its current directory.
 * @param clean - what to say when it really is a repository.
 * @returns the message to show.
 */
async function emptyGitMessage(box: Box, clean: string): Promise<string> {
  try {
    return (await isInsideRepo(box)) ? clean : notARepoMessage();
  } catch {
    // Neither answer is supported by evidence, so claim neither. Saying
    // "(clean)" here would be the same wrong answer this check exists to stop.
    return "(no output; could not check whether this is a git repository)";
  }
}

/**
 * Handle git subcommands: clone, diff, status, commit, push, create-pr, exec, checkout.
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
      yield { type: "log", message: diff || (await emptyGitMessage(box, "(no changes)")) };
      break;
    }
    case "status": {
      const status = await box.git.status();
      yield { type: "log", message: status || (await emptyGitMessage(box, "(clean)")) };
      break;
    }
    case "commit": {
      const message = parts.slice(1).join(" ");
      if (!message) {
        yield { type: "log", message: "Usage: git commit <message>" };
        return;
      }
      const result = await box.git.commit({ message });
      yield { type: "log", message: `Committed ${result.sha}: ${result.message}` };
      break;
    }
    case "push": {
      const branch = parts[1];
      await box.git.push(branch ? { branch } : undefined);
      yield { type: "log", message: branch ? `Pushed to ${branch}` : "Pushed" };
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
    case "config": {
      // Setting the identity is what makes commits from the box attributable.
      const name = readFlagValue(args, "--name");
      const email = readFlagValue(args, "--email");
      if (name === undefined && email === undefined) {
        // There is no GET for the identity, and status() returns porcelain, not
        // config. Ask git itself instead of printing something unrelated.
        // A non-zero `git config --get` means the key is unset, which is an
        // answer. A request that failed is not, and must not be shown as
        // "(unset)": let it propagate, as the non-interactive path does.
        const read = async (key: string): Promise<string> => {
          const result = await box.git.exec({ args: ["config", "--get", key] });
          if (result.exit_code === 0) return result.output.trim();
          // git uses 1 for "not found"; anything else is a real failure.
          if (result.exit_code === 1) return "";
          throw new Error(`Could not read ${key}: git exited ${result.exit_code}`);
        };
        const [userName, userEmail] = await Promise.all([read("user.name"), read("user.email")]);
        const shown = (value: string) => value || "(unset)";
        yield {
          type: "log",
          message: `git identity: ${shown(userName)} <${shown(userEmail)}>`,
        };
        return;
      }
      const updated = await box.git.updateConfig({
        ...(name === undefined ? {} : { userName: name }),
        ...(email === undefined ? {} : { userEmail: email }),
      });
      yield {
        type: "log",
        message: `git identity: ${updated.git_user_name} <${updated.git_user_email}>`,
      };
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
      yield {
        type: "log",
        message:
          "Usage: git <clone|diff|status|commit|push|create-pr|exec|checkout|config> [args...]",
      };
  }
}

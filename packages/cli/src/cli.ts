#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { appendTelemetryIdentity } from "@upstash/box";
import { VERSION } from "./version.js";
import { createCommand } from "./commands/create.js";
import { connectCommand } from "./commands/connect.js";
import { fromSnapshotCommand } from "./commands/from-snapshot.js";
import { listCommand } from "./commands/list.js";
import { getCommand } from "./commands/get.js";
import { initDemoCommand } from "./commands/init-demo.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { completionCommand } from "./commands/completion.js";
import {
  envSetCommand,
  envListCommand,
  envDeleteCommand,
  envSetAllCommand,
} from "./commands/env.js";
import { labelAddCommand, labelRemoveCommand, labelListCommand } from "./commands/labels.js";
import { statusCommand } from "./commands/status.js";
import { useCommand } from "./commands/use.js";
import { execCommand } from "./commands/exec.js";
import {
  filesReadCommand,
  filesWriteCommand,
  filesListCommand,
  filesStatCommand,
  filesMkdirCommand,
  filesRenameCommand,
  filesRemoveCommand,
  filesUploadCommand,
  filesDownloadCommand,
} from "./commands/files.js";
import {
  gitCloneCommand,
  gitStatusCommand,
  gitDiffCommand,
  gitCommitCommand,
  gitCheckoutCommand,
  gitPushCommand,
  gitCreatePrCommand,
  gitConfigCommand,
  gitExecCommand,
} from "./commands/git.js";
import {
  publicUrlCommand,
  publicUrlListCommand,
  publicUrlDeleteCommand,
} from "./commands/public-url.js";
import { runCommandAction } from "./commands/run.js";
import { deleteCommand, pauseCommand } from "./commands/lifecycle.js";
import { note, runCommand } from "./core/io.js";
import { CLI_FAILURE_EXIT_CODE, CliError } from "./core/errors.js";
import type { GlobalFlags } from "./core/io.js";

appendTelemetryIdentity(`@upstash/box-cli@${VERSION}`);

const program = new Command();

program
  .name("box")
  .description("CLI for Upstash Box — REPL-first interface for AI coding agents")
  .version(VERSION)
  // Program-level so both spellings work: `box --json status` and
  // `box status --json`.
  .option("--box <id>", "Box to act on (overrides BOX_ID and any .box file)")
  .option("--json", "Emit machine-readable output on stdout")
  .option("--token <token>", "Upstash Box API token")
  .enablePositionalOptions()
  .passThroughOptions();

/**
 * A subcommand's own flags with the program-level ones filled in.
 *
 * The root accepts --box, --json and --token so both spellings work, which
 * only holds if every action merges them; otherwise `box --token X create`
 * silently drops the token that `box create --token X` accepts.
 * @param local - the subcommand's parsed options.
 * @returns the options to hand the command.
 */
function merged<T extends Record<string, unknown>>(local: T): T & GlobalFlags {
  return { ...local, ...globals(local) };
}

/**
 * Refuse --json for a command that cannot produce it.
 *
 * The root advertises the flag program-wide, so it reaches commands that open
 * a REPL or print a shell script. Accepting it there would answer an
 * automation caller with a prompt, or with text it cannot parse.
 * @param flags - the merged flags.
 * @param command - the command name, for the message.
 * @param instead - what to use instead, when there is something.
 */
function refuseJson(flags: GlobalFlags, command: string, instead?: string): void {
  if (!flags.json) return;
  throw new CliError(
    `${command} has no machine-readable output${instead ? `; use ${instead}` : ""}`,
  );
}

/** Global flags merged with a subcommand's own, the subcommand winning. */
function globals(local: Record<string, unknown> = {}): GlobalFlags {
  const root = program.opts<GlobalFlags>();
  return {
    box: (local.box as string | undefined) ?? root.box,
    json: (local.json as boolean | undefined) ?? root.json,
    token: (local.token as string | undefined) ?? root.token,
  };
}

program
  .command("status")
  .description("Show which box is selected, where that came from, and its state")
  .option("--token <token>", "Upstash Box API token")
  .option("--box <id>", "Box to act on")
  .option("--json", "Emit machine-readable output")
  .action(async (flags: Record<string, unknown>) => {
    await runCommand(async () => statusCommand(globals(flags)));
  });

program
  .command("exec")
  // Variadic so the remote command survives as separate words, and Commander
  // stops parsing at `--`, which is what keeps `-la` or `--grep` from being
  // read as flags of box itself.
  .argument("[command...]", "Command to run in the box; put it after --")
  .description("Run a shell command inside the box")
  .option("-C, --cwd <dir>", "Working directory inside the box")
  .option("--box <id>", "Box to act on")
  .option("--json", "Collect output into one object instead of streaming")
  .option("--token <token>", "Upstash Box API token")
  .action(async (parts: string[], flags: Record<string, unknown>) => {
    await runCommand(async () =>
      execCommand(parts, { ...globals(flags), cwd: flags.cwd as string | undefined }),
    );
  });

const files = program.command("files").description("File operations inside the box");
/** Flags every file verb accepts, declared once. */
const withCommon = (cmd: import("commander").Command) =>
  cmd
    .option("--box <id>", "Box to act on")
    .option("--json", "Emit machine-readable output")
    .option("--token <token>", "Upstash Box API token");

withCommon(files.command("read").argument("<path>").description("Read a file"))
  .option("--encoding <encoding>", "Set to base64 for binary files")
  .option("--offset <bytes>", "Byte offset; only meaningful with --length")
  .option("--length <bytes>", "Read only this many bytes (max 8 MiB)")
  .action(async (path: string, flags: Record<string, unknown>) => {
    await runCommand(async () => filesReadCommand(path, { ...globals(flags), ...flags }));
  });

withCommon(
  files
    .command("write")
    .argument("<path>")
    .argument("[content]", "Content, or - to read stdin")
    .description("Write a file"),
)
  .option("--encoding <encoding>", "Set to base64 when content is base64")
  .action(async (path: string, content: string | undefined, flags: Record<string, unknown>) => {
    await runCommand(async () => filesWriteCommand(path, content, { ...globals(flags), ...flags }));
  });

withCommon(files.command("list").argument("[path]").description("List a directory")).action(
  async (path: string | undefined, flags: Record<string, unknown>) => {
    await runCommand(async () => filesListCommand(path, { ...globals(flags), ...flags }));
  },
);

withCommon(files.command("stat").argument("<path>").description("Path metadata"))
  .option("--follow", "Follow a final symlink")
  .action(async (path: string, flags: Record<string, unknown>) => {
    await runCommand(async () => filesStatCommand(path, { ...globals(flags), ...flags }));
  });

withCommon(files.command("mkdir").argument("<path>").description("Create a directory"))
  .option("-p, --parents", "Create missing parents")
  .action(async (path: string, flags: Record<string, unknown>) => {
    await runCommand(async () => filesMkdirCommand(path, { ...globals(flags), ...flags }));
  });

withCommon(
  files.command("rename").argument("<from>").argument("<to>").description("Move or rename"),
).action(async (from: string, to: string, flags: Record<string, unknown>) => {
  await runCommand(async () => filesRenameCommand(from, to, { ...globals(flags), ...flags }));
});

withCommon(files.command("remove").argument("<path>").description("Delete a path"))
  .option("-r, --recursive", "Required to remove a directory")
  .action(async (path: string, flags: Record<string, unknown>) => {
    await runCommand(async () => filesRemoveCommand(path, { ...globals(flags), ...flags }));
  });

withCommon(
  files
    .command("upload")
    .argument("<local-path>")
    .argument("<destination>")
    .description("Copy a local file into the box"),
).action(async (local: string, destination: string, flags: Record<string, unknown>) => {
  await runCommand(async () =>
    filesUploadCommand(local, destination, { ...globals(flags), ...flags }),
  );
});

withCommon(
  files.command("download").argument("[folder]").description("Download files from the box"),
).action(async (folder: string | undefined, flags: Record<string, unknown>) => {
  await runCommand(async () => filesDownloadCommand(folder, { ...globals(flags), ...flags }));
});

const git = program.command("git").description("Git operations inside the box");
/** Every git verb takes the same box flags plus an optional repo folder. */
const withGitCommon = (cmd: import("commander").Command) =>
  withCommon(cmd).option("-C, --folder <dir>", "Repository directory inside the box");

withGitCommon(git.command("clone").argument("<repo>").description("Clone a repository"))
  .option("--branch <branch>", "Branch to clone")
  .option("--depth <n>", "Shallow clone depth")
  .option("--github-token <token>", "Token for a private repository")
  .action(async (repo: string, flags: Record<string, unknown>) => {
    await runCommand(async () => gitCloneCommand(repo, { ...globals(flags), ...flags }));
  });

withGitCommon(git.command("status").description("Working tree status")).action(
  async (flags: Record<string, unknown>) => {
    await runCommand(async () => gitStatusCommand({ ...globals(flags), ...flags }));
  },
);

withGitCommon(git.command("diff").description("Working tree diff")).action(
  async (flags: Record<string, unknown>) => {
    await runCommand(async () => gitDiffCommand({ ...globals(flags), ...flags }));
  },
);

withGitCommon(git.command("commit").description("Commit staged changes"))
  .requiredOption("-m, --message <message>", "Commit message")
  .option("--author-name <name>", "Commit author name")
  .option("--author-email <email>", "Commit author email")
  .action(async (flags: Record<string, unknown>) => {
    await runCommand(async () => gitCommitCommand({ ...globals(flags), ...flags }));
  });

withGitCommon(
  git.command("checkout").argument("<branch>").description("Switch branches, creating if needed"),
)
  // Accepted because it is what a git user types; the branch is created either
  // way, so it has nothing to switch on.
  .option("-b, --create", "Accepted for familiarity with git; branches are always created")
  .action(async (branch: string, flags: Record<string, unknown>) => {
    await runCommand(async () => gitCheckoutCommand(branch, { ...globals(flags), ...flags }));
  });

withGitCommon(git.command("push").description("Push the current branch"))
  .option("--branch <branch>", "Branch to push")
  .action(async (flags: Record<string, unknown>) => {
    await runCommand(async () => gitPushCommand({ ...globals(flags), ...flags }));
  });

withGitCommon(git.command("create-pr").description("Open a pull request"))
  .requiredOption("--title <title>", "Pull request title")
  .option("--body <body>", "Pull request body")
  .option("--base <branch>", "Base branch")
  .action(async (flags: Record<string, unknown>) => {
    await runCommand(async () => gitCreatePrCommand({ ...globals(flags), ...flags }));
  });

withGitCommon(git.command("config").description("Show or set the git identity"))
  .option("--name <name>", "git user.name")
  .option("--email <email>", "git user.email")
  .action(async (flags: Record<string, unknown>) => {
    await runCommand(async () => gitConfigCommand({ ...globals(flags), ...flags }));
  });

withGitCommon(
  git
    .command("exec")
    .argument("[args...]", "git arguments without the leading git; put them after --")
    .description("Any other git command, and the search path (grep, ls-files)"),
).action(async (args: string[], flags: Record<string, unknown>) => {
  await runCommand(async () => gitExecCommand(args, { ...globals(flags), ...flags }));
});

const publicUrl = program
  .command("public-url")
  .description("Public URLs for ports inside the box")
  .argument("[port]", "Port to publish; omit to list")
  .option("--basic-auth", "Protect the URL with generated basic-auth credentials")
  .option("--bearer-token", "Protect the URL with a generated bearer token")
  .option("--box <id>", "Box to act on")
  .option("--json", "Emit machine-readable output")
  .option("--token <token>", "Upstash Box API token")
  .action(async (port: string | undefined, flags: Record<string, unknown>) => {
    // A bare `box public-url` lists, matching the REPL, so the common
    // `box public-url 3000` stays a word shorter than a `create` subcommand.
    await runCommand(async () =>
      port === undefined
        ? publicUrlListCommand(globals(flags))
        : publicUrlCommand(port, { ...globals(flags), ...flags }),
    );
  });

publicUrl
  .command("list")
  .description("List the box's public URLs")
  .option("--box <id>", "Box to act on")
  .option("--json", "Emit machine-readable output")
  .option("--token <token>", "Upstash Box API token")
  .action(async (flags: Record<string, unknown>) => {
    await runCommand(async () => publicUrlListCommand(globals(flags)));
  });

publicUrl
  .command("delete")
  .argument("<port>")
  .description("Withdraw the public URL for a port")
  .option("--box <id>", "Box to act on")
  .option("--json", "Emit machine-readable output")
  .option("--token <token>", "Upstash Box API token")
  .action(async (port: string, flags: Record<string, unknown>) => {
    await runCommand(async () => publicUrlDeleteCommand(port, globals(flags)));
  });

program
  .command("run")
  .argument("[prompt...]", "Prompt for the agent, or - to read it from stdin")
  .description("Run the box's agent on a prompt")
  .option("--timeout <seconds>", "Give up after this long")
  .option("-q, --quiet", "Do not log tool calls to stderr")
  .option("--box <id>", "Box to act on")
  .option("--json", "Print the result as one object instead of streaming")
  .option("--token <token>", "Upstash Box API token")
  .action(async (parts: string[], flags: Record<string, unknown>) => {
    await runCommand(async () => runCommandAction(parts, { ...globals(flags), ...flags }));
  });

program
  .command("delete")
  .argument("[box-id]", "Box to delete; defaults to the selected one")
  .description("Delete a box and everything in it")
  .option("-y, --yes", "Skip the confirmation prompt")
  .option("--box <id>", "Box to act on")
  .option("--json", "Emit machine-readable output")
  .option("--token <token>", "Upstash Box API token")
  .action(async (boxId: string | undefined, flags: Record<string, unknown>) => {
    await runCommand(async () =>
      deleteCommand(boxId, { ...globals(flags), yes: Boolean(flags.yes) }),
    );
  });

program
  .command("pause")
  .argument("[box-id]", "Box to pause; defaults to the selected one")
  .description("Pause a box; the next command resumes it")
  .option("--box <id>", "Box to act on")
  .option("--json", "Emit machine-readable output")
  .option("--token <token>", "Upstash Box API token")
  .action(async (boxId: string | undefined, flags: Record<string, unknown>) => {
    await runCommand(async () => pauseCommand(boxId, globals(flags)));
  });

program
  .command("use")
  .argument("[box-id]", "Box to select for this directory")
  .description("Write a .box file so later commands need no --box")
  .option("--unset", "Remove this directory's own .box (never a parent's)")
  .option("--json", "Emit machine-readable output")
  .action(async (boxId: string | undefined, flags: Record<string, unknown>) => {
    await runCommand(async () =>
      useCommand(boxId, { ...globals(flags), unset: Boolean(flags.unset) }),
    );
  });

program
  .command("create")
  .description("Create a new box and enter the REPL")
  .option("--token <token>", "Upstash Box API token")
  .option(
    "--runtime <runtime>",
    "Runtime environment (node, python, golang, ruby, rust; append -alpine for smaller musl images)",
  )
  .option("--agent-model <model>", "Agent model identifier")
  .option("--agent-harness <harness>", "Agent harness (claude-code, codex, opencode, cursor)")
  .option("--agent-provider <provider>", "Agent provider (claude-code, codex, opencode, cursor)")
  .option("--agent-runner <runner>")
  .option(
    "--agent-api-key [key]",
    'Agent API key — omit to use Upstash-managed key, or pass "stored" to use a key saved in the Upstash console',
  )
  .option("--git-token <token>", "GitHub personal access token")
  .option("--git-user-name <name>", "Git user.name to set in the box")
  .option("--git-user-email <email>", "Git user.email to set in the box")
  .option(
    "--env <KEY=VAL>",
    "Environment variable (repeatable)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option(
    "--label <label>",
    "Label to tag the box with (repeatable)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option("--name <name>", "Human-readable name for the box")
  .option("--size <size>", "Resource size (small, medium, large)")
  .option("--keep-alive", "Keep the box running instead of pausing when idle")
  .option("--init-command <command>", "Startup script, for keep-alive boxes")
  .option("--browser", "Provision a headless Chromium in the box")
  .option("--clone-repo <repo>", "Clone this repository into the box after creating it")
  .option("--no-repl", "Create the box, print its id and exit")
  .option("--no-use", "Do not write a .box file for the new box")
  .option("--json", "Print the new box as one object (implies --no-repl)")
  .action(async (opts) => {
    await runCommand(async () => createCommand(merged(opts)));
  });

program
  .command("connect [box-id]")
  .description("Connect to an existing box (or most recent) and enter the REPL")
  .option("--token <token>", "Upstash Box API token")
  .action(async (boxId, opts) =>
    runCommand(async () => {
      refuseJson(merged(opts), "box connect", "box create --no-repl --json");
      return connectCommand(boxId, merged(opts));
    }),
  );

program
  .command("from-snapshot <snapshot-id>")
  .description("Create a new box from a snapshot and enter the REPL")
  .option("--token <token>", "Upstash Box API token")
  .option("--runtime <runtime>", "Runtime environment")
  .option("--agent-model <model>", "Agent model identifier")
  .option("--agent-harness <harness>", "Agent harness (claude-code, codex, opencode, cursor)")
  .option("--agent-provider <provider>", "Agent provider (claude-code, codex, opencode, cursor)")
  .option("--agent-runner <runner>")
  .option(
    "--agent-api-key [key]",
    'Agent API key — omit to use Upstash-managed key, or pass "stored" to use a key saved in the Upstash console',
  )
  .option("--git-token <token>", "GitHub personal access token")
  .option(
    "--env <KEY=VAL>",
    "Environment variable (repeatable)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option(
    "--label <label>",
    "Label to tag the box with (repeatable)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .action(async (snapshotId, opts) =>
    runCommand(async () => {
      refuseJson(merged(opts), "box from-snapshot", "box create --no-repl --json");
      return fromSnapshotCommand(snapshotId, merged(opts));
    }),
  );

program
  .command("list")
  .description("List all boxes")
  .option("--json", "Emit machine-readable output")
  .option("--token <token>", "Upstash Box API token")
  .option("--label <label>", "Only show boxes carrying this label")
  .action(async (opts) => runCommand(async () => listCommand(merged(opts))));

program
  .command("get <box-id>")
  .description("Get details about a box")
  .option("--token <token>", "Upstash Box API token")
  .option("--json", "Emit machine-readable output")
  .action(async (boxId: string, flags: Record<string, unknown>) => {
    await runCommand(async () => getCommand(boxId, globals(flags)));
  });

program
  .command("snapshot [box-id]")
  .description("Create a snapshot of a box")
  .option("--json", "Emit machine-readable output")
  .option("--token <token>", "Upstash Box API token")
  .option("--name <name>", "Snapshot name")
  .action(async (boxId, opts) => runCommand(async () => snapshotCommand(boxId, merged(opts))));

program
  .command("init-demo")
  .description("Scaffold a standalone demo project for @upstash/box")
  .option("--token <token>", "Upstash Box API token")
  .option("--agent-model <model>", "Agent model identifier")
  .option(
    "--agent-api-key [key]",
    'Agent API key — omit to use Upstash-managed key, or pass "stored" to use a key saved in the Upstash console',
  )
  .option("--runtime <runtime>", "Runtime environment", "node")
  .option("--git-token <token>", "GitHub personal access token")
  .option("--directory <dir>", "Output directory", "box-demo")
  .action(async (opts) =>
    runCommand(async () => {
      refuseJson(merged(opts), "box init-demo");
      return initDemoCommand(merged(opts));
    }),
  );

const envCmd = program.command("env").description("Manage user-level env vars");

envCmd
  .command("set <key> <value>")
  .option("--json", "Emit machine-readable output")
  .description("Upsert a user-level env var")
  .option("--token <token>", "Upstash Box API token")
  .action(async (key, value, opts) =>
    runCommand(async () => envSetCommand(key, value, merged(opts))),
  );

envCmd
  .command("list")
  .option("--json", "Emit machine-readable output")
  .description("List user-level env vars (values are masked)")
  .option("--token <token>", "Upstash Box API token")
  .action(async (opts) => runCommand(async () => envListCommand(merged(opts))));

envCmd
  .command("delete <key>")
  .option("--json", "Emit machine-readable output")
  .description("Delete a user-level env var")
  .option("--token <token>", "Upstash Box API token")
  .action(async (key, opts) => runCommand(async () => envDeleteCommand(key, merged(opts))));

envCmd
  .command("set-all")
  .option("--json", "Emit machine-readable output")
  .description("Full-replace all user-level env vars (KEY=VALUE ...)")
  .option("--token <token>", "Upstash Box API token")
  .argument("<vars...>", "Key=value pairs")
  .action(async (vars, opts) => runCommand(async () => envSetAllCommand(vars, merged(opts))));

const labelsCmd = program.command("labels").description("Manage labels on a box");

labelsCmd
  .command("add <box-id> <label>")
  .option("--json", "Emit machine-readable output")
  .description("Add a label to a box")
  .option("--token <token>", "Upstash Box API token")
  .action(async (boxId, label, opts) =>
    runCommand(async () => labelAddCommand(boxId, label, merged(opts))),
  );

labelsCmd
  .command("remove <box-id> <label>")
  .option("--json", "Emit machine-readable output")
  .description("Remove a label from a box")
  .option("--token <token>", "Upstash Box API token")
  .action(async (boxId, label, opts) =>
    runCommand(async () => labelRemoveCommand(boxId, label, merged(opts))),
  );

labelsCmd
  .command("list <box-id>")
  .option("--json", "Emit machine-readable output")
  .description("List a box's labels")
  .option("--token <token>", "Upstash Box API token")
  .action(async (boxId, opts) => runCommand(async () => labelListCommand(boxId, merged(opts))));

program
  .command("completion")
  .description('Output shell completion script (eval "$(box completion)")')
  .action(async (opts) =>
    runCommand(async () => {
      refuseJson(merged(opts as Record<string, unknown>), "box completion");
      completionCommand();
    }),
  );

// Commander reports usage errors (unknown option, missing argument) before any
// action runs, and exits 1 by default. That is indistinguishable from a remote
// command that exited 1, which is the whole reason CLI failures use 125.
// exitOverride turns them into exceptions so they can be mapped.
/** Apply the override to a command and everything nested under it. */
function overrideExits(command: import("commander").Command): void {
  command.exitOverride();
  for (const child of command.commands) overrideExits(child);
}
overrideExits(program);

try {
  program.parse();
} catch (error) {
  const code = (error as { code?: string }).code ?? "";
  // Help and version are successful outcomes that Commander also raises here.
  if (
    code === "commander.helpDisplayed" ||
    code === "commander.help" ||
    code === "commander.version"
  ) {
    process.exit(0);
  }
  // Commander has already written its own diagnostic for a usage error, so
  // repeating it here printed everything twice. Anything else reaching this
  // point is unexpected and has not been reported yet.
  if (!code.startsWith("commander.")) {
    const message = (error as { message?: string }).message;
    if (message) note(message.replace(/^error: /, "Error: "));
  }
  process.exit(CLI_FAILURE_EXIT_CODE);
}

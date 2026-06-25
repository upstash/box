#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
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

const program = new Command();

program
  .name("box")
  .description("CLI for Upstash Box — REPL-first interface for AI coding agents")
  .version("0.1.0");

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
  .action((opts) => createCommand(opts));

program
  .command("connect [box-id]")
  .description("Connect to an existing box (or most recent) and enter the REPL")
  .option("--token <token>", "Upstash Box API token")
  .action((boxId, opts) => connectCommand(boxId, opts));

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
  .action((snapshotId, opts) => fromSnapshotCommand(snapshotId, opts));

program
  .command("list")
  .description("List all boxes")
  .option("--token <token>", "Upstash Box API token")
  .action((opts) => listCommand(opts));

program
  .command("get <box-id>")
  .description("Get details about a box")
  .option("--token <token>", "Upstash Box API token")
  .action((boxId, opts) => getCommand(boxId, opts));

program
  .command("snapshot [box-id]")
  .description("Create a snapshot of a box")
  .option("--token <token>", "Upstash Box API token")
  .option("--name <name>", "Snapshot name")
  .action((boxId, opts) => snapshotCommand(boxId, opts));

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
  .action((opts) => initDemoCommand(opts));

const envCmd = program.command("env").description("Manage user-level env vars");

envCmd
  .command("set <key> <value>")
  .description("Upsert a user-level env var")
  .option("--token <token>", "Upstash Box API token")
  .action((key, value, opts) => envSetCommand(key, value, opts));

envCmd
  .command("list")
  .description("List user-level env vars (values are masked)")
  .option("--token <token>", "Upstash Box API token")
  .action((opts) => envListCommand(opts));

envCmd
  .command("delete <key>")
  .description("Delete a user-level env var")
  .option("--token <token>", "Upstash Box API token")
  .action((key, opts) => envDeleteCommand(key, opts));

envCmd
  .command("set-all")
  .description("Full-replace all user-level env vars (KEY=VALUE ...)")
  .option("--token <token>", "Upstash Box API token")
  .argument("<vars...>", "Key=value pairs")
  .action((vars, opts) => envSetAllCommand(vars, opts));

program
  .command("completion")
  .description('Output shell completion script (eval "$(box completion)")')
  .action(() => completionCommand());

program.parse();

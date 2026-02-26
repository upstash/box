#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { createCommand } from "./commands/create.js";
import { connectCommand } from "./commands/connect.js";
import { fromSnapshotCommand } from "./commands/from-snapshot.js";
import { listCommand } from "./commands/list.js";
import { getCommand } from "./commands/get.js";
import { initDemoCommand } from "./commands/init-demo.js";
import { completionCommand } from "./commands/completion.js";

const program = new Command();

program
  .name("box")
  .description("CLI for Upstash Box — REPL-first interface for AI coding agents")
  .version("0.1.0");

program
  .command("create")
  .description("Create a new box and enter the REPL")
  .option("--token <token>", "Upstash Box API token")
  .option("--runtime <runtime>", "Runtime environment (node, python, golang, ruby, rust)")
  .option("--agent-model <model>", "Agent model identifier")
  .option("--agent-api-key <key>", "Agent API key (Anthropic or OpenAI)")
  .option("--git-token <token>", "GitHub personal access token")
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
  .option("--agent-api-key <key>", "Agent API key")
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
  .command("init-demo")
  .description("Scaffold a standalone demo project for @upstash/box")
  .option("--token <token>", "Upstash Box API token")
  .option("--agent-model <model>", "Agent model identifier")
  .option("--agent-api-key <key>", "Agent API key (required if --agent-model is set)")
  .option("--runtime <runtime>", "Runtime environment", "node")
  .option("--git-token <token>", "GitHub personal access token")
  .option("--directory <dir>", "Output directory", "box-demo")
  .action((opts) => initDemoCommand(opts));

program
  .command("completion")
  .description('Output shell completion script (eval "$(box completion)")')
  .action(() => completionCommand());

program.parse();

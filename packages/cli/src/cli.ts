#!/usr/bin/env node
import "dotenv/config";
import type { Command } from "commander";
import { buildBoxProgram } from "./program.js";
import { note } from "./core/io.js";
import { CLI_FAILURE_EXIT_CODE } from "./core/errors.js";

const program = buildBoxProgram();

// Commander reports usage errors (unknown option, missing argument) before any
// action runs, and exits 1 by default. That is indistinguishable from a remote
// command that exited 1, which is the whole reason CLI failures use 125.
// exitOverride turns them into exceptions so they can be mapped.
/** Apply the override to a command and everything nested under it. */
function overrideExits(command: Command): void {
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

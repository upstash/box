import { Box } from "@upstash/box";
import type { AgentConfig, Runtime } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { resolveAgentApiKey } from "../agent-key.js";
import { startRepl } from "../repl/terminal.js";
import { CliError } from "../core/errors.js";
import { writeBoxFile } from "../core/box-ref.js";
import { emit, note } from "../core/io.js";

function resolveCliAgentHarness(harness: string | undefined): string | undefined {
  if (!harness) return undefined;
  switch (harness) {
    case "claude-code":
    case "codex":
    case "opencode":
    case "cursor":
      return harness;
    case "custom":
      throw new CliError(
        "custom agent boxes require customHarness config and are not supported by this CLI command yet. Use the SDK or REST API.",
      );
    default:
      throw new CliError(`Unknown agent harness: ${harness}`);
  }
}

interface FromSnapshotFlags {
  token?: string;
  runtime?: string;
  agentModel?: string;
  agentHarness?: string;
  /** @deprecated Use `agentHarness` instead. */
  agentProvider?: string;
  /** @deprecated Use `agentProvider` instead. */
  agentRunner?: string;
  agentApiKey?: string | true;
  gitToken?: string;
  env?: string[];
  label?: string[];
  /** false when --no-repl was passed. */
  repl?: boolean;
  json?: boolean;
  use?: boolean;
}

/**
 * Whether to restore without opening a REPL.
 *
 * Same rule as `box create`: an explicit --no-repl, --json, or the absence of a
 * terminal on either stream. Without this the only way to restore a snapshot
 * was a REPL that a script has nobody to drive, so listing and deleting
 * snapshots was a write-only feature.
 * @param flags - the flags as given.
 * @returns true when the command should not open a REPL.
 */
function isHeadlessRestore(flags: FromSnapshotFlags): boolean {
  if (flags.repl === false) return true;
  if (flags.json) return true;
  return !process.stdin.isTTY || !process.stdout.isTTY;
}

export async function fromSnapshotCommand(
  snapshotId: string,
  flags: FromSnapshotFlags,
): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const agentHarness = resolveCliAgentHarness(
    flags.agentHarness ?? flags.agentProvider ?? flags.agentRunner,
  );

  const env: Record<string, string> = {};
  if (flags.env) {
    for (const e of flags.env) {
      const idx = e.indexOf("=");
      if (idx === -1) {
        throw new CliError(`Invalid env format: ${e} (expected KEY=VAL)`);
      }
      env[e.slice(0, idx)] = e.slice(idx + 1);
    }
  }

  if (flags.agentModel && !agentHarness) {
    throw new CliError(
      "agent harness is required when --agent-model is set. Use --agent-harness (preferred), or the deprecated aliases --agent-provider / --agent-runner.",
    );
  }

  const headless = isHeadlessRestore(flags);
  if (!headless) console.log("Creating box from snapshot...");
  else note("Creating box from snapshot...");
  const box = await Box.fromSnapshot(snapshotId, {
    apiKey,
    runtime: flags.runtime as Runtime,
    agent: flags.agentModel
      ? ({
          harness: agentHarness!,
          model: flags.agentModel,
          apiKey: resolveAgentApiKey(flags.agentApiKey),
        } as AgentConfig)
      : undefined,
    git: flags.gitToken ? { token: flags.gitToken } : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    labels: flags.label && flags.label.length > 0 ? flags.label : undefined,
  });

  if (!headless) {
    await startRepl(box);
    return;
  }

  // Pin it, so the commands that follow need no --box. Same as headless create.
  const pinned = flags.use === false ? undefined : writeBoxFile(box.id);
  emit(
    { id: box.id, ...(pinned === undefined ? {} : { box_file: pinned }) },
    [box.id, ...(pinned === undefined ? [] : [`Pinned to ${pinned}`])],
    flags,
  );
}

import { Box } from "@upstash/box";
import type { AgentConfig, BoxSize, Runtime } from "@upstash/box";
import { writeBoxFile } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, note, requireToken } from "../core/io.js";
import { resolveAgentApiKey } from "../agent-key.js";
import { startRepl } from "../repl/terminal.js";
import { createWizard } from "./create-wizard.js";
import { dim } from "../utils/ansi.js";

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

export interface CreateFlags {
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
  gitUserName?: string;
  gitUserEmail?: string;
  env?: string[];
  label?: string[];
  name?: string;
  size?: string;
  keepAlive?: boolean;
  initCommand?: string;
  browser?: boolean;
  cloneRepo?: string;
  /** Commander sets this to false for --no-repl. */
  repl?: boolean;
  json?: boolean;
  /** Commander sets this to false for --no-use. */
  use?: boolean;
}

/**
 * Whether to create the box and exit rather than open the REPL.
 *
 * A pipe or a CI job has no terminal to drive the REPL, so a create that ends
 * in one would hang with the box already billing. `--json` implies it too,
 * since the REPL's output is not machine-readable.
 *
 * Both streams have to be checked. `ID=$(box create --runtime node)` keeps
 * stdin on the terminal but captures stdout, so a stdin-only test would open
 * a REPL whose output nobody can see, holding a billing box open.
 * @param flags - the create flags as given.
 * @returns true when the REPL must be skipped.
 */
export function isHeadlessCreate(flags: CreateFlags): boolean {
  if (flags.repl === false) return true;
  if (flags.json) return true;
  return !process.stdin.isTTY || !process.stdout.isTTY;
}

/**
 * Whether the caller already said what kind of box they want.
 *
 * Anything that configures the box counts, including the workspace flags: a
 * caller that passed --clone-repo has answered the question the wizard exists
 * to ask.
 * @param flags - the create flags as given.
 * @returns true when there is nothing left to ask.
 */
function hasConfigFlags(flags: CreateFlags): boolean {
  return (
    flags.agentModel !== undefined ||
    flags.agentApiKey !== undefined ||
    flags.runtime !== undefined ||
    flags.gitToken !== undefined ||
    flags.gitUserName !== undefined ||
    flags.gitUserEmail !== undefined ||
    flags.name !== undefined ||
    flags.size !== undefined ||
    flags.keepAlive !== undefined ||
    flags.initCommand !== undefined ||
    flags.browser !== undefined ||
    flags.cloneRepo !== undefined ||
    (flags.env !== undefined && flags.env.length > 0) ||
    (flags.label !== undefined && flags.label.length > 0)
  );
}

export async function createCommand(flags: CreateFlags): Promise<void> {
  const apiKey = requireToken(flags.token);
  const headless = isHeadlessCreate(flags);

  // A headless create has no one to answer the wizard, whether or not there is
  // a terminal attached: `box create --no-repl --clone-repo ...` from a
  // developer's shell is the same scripted path as one from CI.
  if (!headless && !hasConfigFlags(flags) && process.stdin.isTTY) {
    const wizardResult = await createWizard();
    if (!wizardResult) {
      console.log(dim("Aborted."));
      return;
    }
    flags = { ...flags, ...wizardResult };
  }

  // After the wizard, not before: the wizard is where the harness comes from on
  // a bare `box create`, and resolving first rejected its own answer.
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

  // The backend rejects a startup script on a box that is allowed to pause.
  if (flags.initCommand !== undefined && !flags.keepAlive) {
    throw new CliError("--init-command only applies to a keep-alive box; add --keep-alive");
  }

  // In headless mode stdout carries the box id and nothing else, so progress
  // goes to stderr.
  if (headless) note("Creating box...");
  else console.log("\nCreating box...");

  const box = await Box.create({
    apiKey,
    runtime: flags.runtime as Runtime,
    ...(flags.name === undefined ? {} : { name: flags.name }),
    ...(flags.size === undefined ? {} : { size: flags.size as BoxSize }),
    ...(flags.keepAlive ? { keepAlive: true } : {}),
    ...(flags.initCommand === undefined ? {} : { initCommand: flags.initCommand }),
    ...(flags.browser ? { browser: true } : {}),
    agent: flags.agentModel
      ? ({
          harness: agentHarness!,
          model: flags.agentModel,
          apiKey: resolveAgentApiKey(flags.agentApiKey),
        } as AgentConfig)
      : undefined,
    git:
      flags.gitToken || flags.gitUserName || flags.gitUserEmail
        ? {
            token: flags.gitToken,
            userName: flags.gitUserName,
            userEmail: flags.gitUserEmail,
          }
        : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    labels: flags.label && flags.label.length > 0 ? flags.label : undefined,
  });

  if (flags.cloneRepo) {
    if (headless) note(`Cloning ${flags.cloneRepo}...`);
    try {
      await box.git.clone({
        repo: flags.cloneRepo,
        ...(flags.gitToken === undefined ? {} : { githubToken: flags.gitToken }),
      });
    } catch (error) {
      // The box exists and is billing. Failing here without naming it would
      // leave the caller unable to reuse or delete it.
      if (flags.use !== false) {
        try {
          writeBoxFile(box.id);
        } catch {
          // Reporting the id below is the part that matters.
        }
      }
      note(`The box was created: ${box.id}`);
      note(`Delete it with: box delete --yes ${box.id}`);
      throw new CliError(`Created ${box.id}, but cloning ${flags.cloneRepo} failed`, {
        cause: error,
      });
    }
  }

  if (!headless) {
    await startRepl(box);
    return;
  }

  // Pinning the box here is what lets every later command run without --box,
  // which is the whole point of a create that a script can drive.
  let pinned: string | undefined;
  if (flags.use !== false) {
    try {
      pinned = writeBoxFile(box.id);
    } catch (error) {
      note(`Could not write .box: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  emit({ id: box.id, pinned: pinned ?? null }, box.id, { json: flags.json });
  if (pinned) note(`Pinned to ${pinned}`);
}

import { readFileSync } from "node:fs";
import { Box } from "@upstash/box";
import type { AgentConfig, BoxSize, McpServerConfig, Runtime } from "@upstash/box";
import { writeBoxFile } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { buildNetworkPolicy } from "../core/network-policy.js";
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
  networkPolicy?: string;
  allowDomain?: string[];
  allowCidr?: string[];
  denyCidr?: string[];
  skill?: string[];
  attachHeader?: string[];
  attachHeadersFile?: string;
  mcp?: string[];
  mcpFile?: string;
  /** Commander sets this to false for --no-repl. */
  repl?: boolean;
  json?: boolean;
  /** Commander sets this to false for --no-use. */
  use?: boolean;
}

/** Read and parse a JSON flag file, naming the file when either step fails. */
function readJsonFile(path: string, flag: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new CliError(`Could not read ${flag}: ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(`${flag} is not valid JSON: ${path}`);
  }
}

/**
 * Parse `--attach-header host:Name=value` entries.
 *
 * Host patterns carry no colon of their own (`*.example.com`), so the first
 * colon separates the host and the first `=` after it separates the value.
 * @param entries - the raw flag values.
 * @returns headers keyed by host pattern.
 */
function parseAttachHeaders(entries: string[]): Record<string, Record<string, string>> {
  const headers: Record<string, Record<string, string>> = {};
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const eq = entry.indexOf("=", colon + 1);
    if (colon <= 0 || eq === -1) {
      throw new CliError(`Invalid --attach-header: ${entry} (expected host:Name=value)`);
    }
    const host = entry.slice(0, colon);
    const name = entry.slice(colon + 1, eq);
    if (!name) throw new CliError(`Invalid --attach-header: ${entry} (header name is empty)`);
    headers[host] = { ...headers[host], [name]: entry.slice(eq + 1) };
  }
  return headers;
}

/** Validate the `--attach-headers-file` shape, which is host -> name -> value. */
function parseAttachHeadersFile(path: string): Record<string, Record<string, string>> {
  const body = readJsonFile(path, "--attach-headers-file");
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new CliError("--attach-headers-file must hold a JSON object keyed by host pattern");
  }
  for (const [host, value] of Object.entries(body)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CliError(`--attach-headers-file: ${host} must map header names to string values`);
    }
    for (const [name, header] of Object.entries(value)) {
      if (typeof header !== "string") {
        throw new CliError(`--attach-headers-file: ${host}.${name} must be a string`);
      }
    }
  }
  return body as Record<string, Record<string, string>>;
}

/**
 * Parse `--mcp name=spec` entries.
 *
 * A spec that looks like a URL is a remote server; anything else is an npm
 * package run on the box. Servers needing args or headers go through
 * --mcp-file, which takes the full object.
 * @param entries - the raw flag values.
 * @returns the server configs.
 */
function parseMcpServers(entries: string[]): McpServerConfig[] {
  return entries.map((entry) => {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      throw new CliError(`Invalid --mcp: ${entry} (expected name=package or name=https://url)`);
    }
    const name = entry.slice(0, eq);
    const spec = entry.slice(eq + 1);
    if (!spec) throw new CliError(`Invalid --mcp: ${entry} (nothing after =)`);
    return /^https?:\/\//.test(spec) ? { name, url: spec } : { name, package: spec };
  });
}

/** Validate the `--mcp-file` shape: an array of servers, each remote or a package. */
function parseMcpFile(path: string): McpServerConfig[] {
  const body = readJsonFile(path, "--mcp-file");
  if (!Array.isArray(body)) {
    throw new CliError("--mcp-file must hold a JSON array of MCP server objects");
  }
  for (const server of body) {
    if (typeof server !== "object" || server === null || typeof server.name !== "string") {
      throw new CliError("--mcp-file: every server needs a string name");
    }
    const remote = typeof server.url === "string";
    const local = typeof server.package === "string";
    if (remote === local) {
      throw new CliError(`--mcp-file: ${server.name} needs exactly one of url or package`);
    }
  }
  return body as McpServerConfig[];
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

  const attachHeaders = {
    ...(flags.attachHeadersFile ? parseAttachHeadersFile(flags.attachHeadersFile) : {}),
    ...(flags.attachHeader ? parseAttachHeaders(flags.attachHeader) : {}),
  };
  const mcpServers = [
    ...(flags.mcpFile ? parseMcpFile(flags.mcpFile) : []),
    ...(flags.mcp ? parseMcpServers(flags.mcp) : []),
  ];
  const networkLists = [flags.allowDomain, flags.allowCidr, flags.denyCidr];
  if (flags.networkPolicy === undefined && networkLists.some((list) => list?.length)) {
    throw new CliError("--allow-domain, --allow-cidr and --deny-cidr need --network-policy custom");
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
    ...(flags.skill && flags.skill.length > 0 ? { skills: flags.skill } : {}),
    ...(Object.keys(attachHeaders).length > 0 ? { attachHeaders } : {}),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
    ...(flags.networkPolicy === undefined
      ? {}
      : { networkPolicy: buildNetworkPolicy(flags.networkPolicy, flags) }),
  });

  if (flags.cloneRepo) {
    if (headless) note(`Cloning ${flags.cloneRepo}...`);
    try {
      // --git-token already reached the box through Box.create's git config,
      // which is where the SDK reads it from.
      await box.git.clone({ repo: flags.cloneRepo });
    } catch (error) {
      // The box exists and is billing. Failing here without naming it would
      // leave the caller unable to reuse or delete it.
      // Only for a headless create. A successful interactive create does not
      // pin, so pinning on failure could overwrite a project's existing .box.
      if (headless && flags.use !== false) {
        try {
          writeBoxFile(box.id);
        } catch {
          // Reporting the id below is the part that matters.
        }
      }
      note(`The box was created: ${box.id}`);
      note(`Delete it with: box delete --yes ${box.id}`);
      // The cause is spelled out here because runCommand prints the message
      // only, and the difference between a missing repo, a bad token and an
      // unreachable network is what the caller has to act on.
      const reason = error instanceof Error ? error.message : String(error);
      throw new CliError(`Created ${box.id}, but cloning ${flags.cloneRepo} failed: ${reason}`, {
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

import { Box } from "@upstash/box";
import { announceBox, resolveBoxId } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, note, requireToken, type GlobalFlags } from "../core/io.js";

export type PublicUrlFlags = GlobalFlags & {
  basicAuth?: boolean;
  bearerToken?: boolean;
};

/** Resolve the box once, shared by every verb. */
async function open(flags: GlobalFlags): Promise<Box> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);
  return Box.get(resolved.id, { apiKey: requireToken(flags.token) });
}

/**
 * Parse a port argument.
 * @param value - the argument as given.
 * @returns the port number.
 */
function portFrom(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new CliError(`Not a port: ${value}`);
  }
  return port;
}

/**
 * Publish a port and print its public URL.
 *
 * Credentials are printed once and are not retrievable afterwards, so a caller
 * that wants them should use `--json`.
 */
export async function publicUrlCommand(portArg: string, flags: PublicUrlFlags): Promise<void> {
  const port = portFrom(portArg);
  const box = await open(flags);
  const created = await box.getPublicURL(port, {
    ...(flags.basicAuth ? { basicAuth: true } : {}),
    ...(flags.bearerToken ? { bearerToken: true } : {}),
  });
  const lines = [created.url];
  if (created.username) lines.push(`user: ${created.username}  password: ${created.password}`);
  if (created.token) lines.push(`bearer token: ${created.token}`);
  emit(created, lines, flags);
  // A server started as a plain background job is reaped when the command that
  // launched it finishes, and the URL then 502s.
  note("Start the server detached — ( npm run dev & ) — or it stops with the command.");
}

/** List the box's public URLs. */
export async function publicUrlListCommand(flags: GlobalFlags): Promise<void> {
  const box = await open(flags);
  const { publicURLs } = await box.listPublicURLs();
  if (publicURLs.length === 0 && !flags.json) note("No public URLs.");
  emit(
    publicURLs,
    publicURLs.map((entry) => `${String(entry.port).padEnd(6)}${entry.url}`),
    flags,
  );
}

/** Withdraw the public URL for a port. */
export async function publicUrlDeleteCommand(portArg: string, flags: GlobalFlags): Promise<void> {
  const port = portFrom(portArg);
  const box = await open(flags);
  await box.deletePublicURL(port);
  emit({ port }, `Removed the public URL for port ${port}`, flags);
}

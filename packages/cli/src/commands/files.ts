import { readFileSync } from "node:fs";
import { Box } from "@upstash/box";
import { announceBox, resolveBoxId } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, requireToken, type GlobalFlags } from "../core/io.js";

export type FilesFlags = GlobalFlags & {
  follow?: boolean;
  parents?: boolean;
  recursive?: boolean;
  encoding?: string;
  offset?: string;
  length?: string;
};

/** Resolve the box once, shared by every verb. */
async function open(flags: GlobalFlags): Promise<Box> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);
  return Box.get(resolved.id, { apiKey: requireToken(flags.token) });
}

/**
 * Read content for a write, either from the argument or from stdin.
 *
 * `-` means stdin, which is how a caller writes a file whose contents would
 * otherwise have to survive shell quoting — the normal case for source code.
 * @param content - the content argument as given.
 * @returns the text to write.
 */
function contentFrom(content: string | undefined): string {
  if (content === undefined) {
    throw new CliError("Usage: box files write <path> <content>|-  (- reads stdin)");
  }
  if (content !== "-") return content;
  try {
    return readFileSync(0, "utf8");
  } catch (error) {
    throw new CliError("Could not read content from stdin", { cause: error });
  }
}

/** Largest ranged read the server will serve. */
const MAX_READ_BYTES = 8 * 1024 * 1024;

/**
 * Parse a byte count, rejecting anything the server would refuse.
 *
 * NaN is the dangerous one: sent as a range it produces a request the server
 * cannot honour, with no hint that a flag was mistyped.
 * @param value - the flag as given.
 * @param flag - flag name, for the message.
 * @param max - largest value allowed.
 * @returns the parsed number, or undefined when the flag was not given.
 */
function byteCount(value: string | undefined, flag: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError(`${flag} must be a whole number of bytes, not "${value}"`);
  }
  if (parsed > max) {
    throw new CliError(`${flag} must be at most ${max} bytes`);
  }
  return parsed;
}

/** Read a file out of the box. */
export async function filesReadCommand(path: string, flags: FilesFlags): Promise<void> {
  const box = await open(flags);
  const offset = byteCount(flags.offset, "--offset", Number.MAX_SAFE_INTEGER);
  const length = byteCount(flags.length, "--length", MAX_READ_BYTES);
  // The server selects a ranged read by the presence of length, so an unset
  // length must not be sent at all.
  const content = await box.files.read(path, {
    ...(flags.encoding === "base64" ? { encoding: "base64" as const } : {}),
    ...(length === undefined ? {} : { length, offset: offset ?? 0 }),
  });
  // Raw content, not JSON-wrapped: a caller redirecting this to a file wants
  // the bytes, and --json would only help if it carried metadata too.
  if (flags.json) emit({ path, content }, "", flags);
  else process.stdout.write(content);
}

/** Write a file into the box. */
export async function filesWriteCommand(
  path: string,
  content: string | undefined,
  flags: FilesFlags,
): Promise<void> {
  const text = contentFrom(content);
  const box = await open(flags);
  await box.files.write({
    path,
    content: text,
    ...(flags.encoding === "base64" ? { encoding: "base64" as const } : {}),
  });
  // Bytes, not JS characters: a file of accented text or emoji is longer on
  // disk than its string length says.
  const bytes = Buffer.byteLength(text, "utf8");
  emit({ path, bytes }, `Wrote ${bytes} bytes to ${path}`, flags);
}

/** List one directory in the box. */
export async function filesListCommand(path: string | undefined, flags: FilesFlags): Promise<void> {
  const box = await open(flags);
  const entries = await box.files.list(path);
  emit(
    entries,
    entries.map((entry) => `${entry.name}${entry.is_dir ? "/" : ""}\t${entry.size}`),
    flags,
  );
}

/** Report metadata for a path. */
export async function filesStatCommand(path: string, flags: FilesFlags): Promise<void> {
  const box = await open(flags);
  const info = await box.files.stat(path, flags.follow ? { follow: true } : undefined);
  emit(info, `${info.type}\t${info.size}\t${info.mod_time}\tinode ${info.inode}`, flags);
}

/** Create a directory. */
export async function filesMkdirCommand(path: string, flags: FilesFlags): Promise<void> {
  const box = await open(flags);
  await box.files.mkdir(path, flags.parents ? { parents: true } : undefined);
  emit({ path }, `Created ${path}`, flags);
}

/** Move or rename a path. */
export async function filesRenameCommand(
  from: string,
  to: string,
  flags: FilesFlags,
): Promise<void> {
  const box = await open(flags);
  await box.files.rename(from, to);
  emit({ from, to }, `Renamed ${from} → ${to}`, flags);
}

/** Delete a path. */
export async function filesRemoveCommand(path: string, flags: FilesFlags): Promise<void> {
  const box = await open(flags);
  // The server refuses a directory without this rather than deleting a tree
  // because the caller was imprecise.
  await box.files.remove(path, flags.recursive ? { recursive: true } : undefined);
  emit({ path }, `Removed ${path}`, flags);
}

/** Copy a local file into the box. */
export async function filesUploadCommand(
  localPath: string,
  destination: string,
  flags: FilesFlags,
): Promise<void> {
  const box = await open(flags);
  await box.files.upload([{ path: localPath, destination }]);
  emit({ local_path: localPath, destination }, `Uploaded ${localPath} → ${destination}`, flags);
}

/** Download files from the box to the current directory. */
export async function filesDownloadCommand(
  folder: string | undefined,
  flags: FilesFlags,
): Promise<void> {
  const box = await open(flags);
  await box.files.download(folder === undefined ? undefined : { folder });
  emit({ folder: folder ?? null }, "Downloaded.", flags);
}

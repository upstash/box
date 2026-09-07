import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";
import { hasFlag, splitArgs } from "./args.js";

/**
 * Handle file subcommands: read, write, list, stat, mkdir, rename, remove,
 * upload, download.
 */
export async function* handleFiles(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const parts = args.split(/\s+/);
  const sub = parts[0];
  const rest = splitArgs(parts.slice(1).join(" "));
  const { flags } = rest;
  const [first, second] = rest.positionals;

  switch (sub) {
    case "read": {
      const path = first;
      if (!path) {
        yield { type: "log", message: "Usage: files read <path>" };
        return;
      }
      const content = await box.files.read(path);
      yield { type: "log", message: content };
      break;
    }
    case "write": {
      const path = parts[1];
      const content = parts.slice(2).join(" ");
      if (!path || !content) {
        yield { type: "log", message: "Usage: files write <path> <content>" };
        return;
      }
      await box.files.write({ path, content });
      yield { type: "log", message: `Written to ${path}` };
      break;
    }
    case "list": {
      const path = first;
      const files = await box.files.list(path);
      for (const f of files) {
        const indicator = f.is_dir ? "/" : "";
        yield { type: "log", message: `${f.name}${indicator}\t${f.size}` };
      }
      break;
    }
    case "upload": {
      const localPath = first;
      const destination = second;
      if (!localPath || !destination) {
        yield { type: "log", message: "Usage: files upload <local-path> <destination>" };
        return;
      }
      await box.files.upload([{ path: localPath, destination }]);
      yield { type: "log", message: `Uploaded ${localPath} → ${destination}` };
      break;
    }
    case "stat": {
      const path = first;
      if (!path) {
        yield { type: "log", message: "Usage: files stat <path> [--follow]" };
        return;
      }
      // Without --follow this reports the link itself, matching lstat.
      const follow = hasFlag(flags, ["--follow", "-L"]);
      const info = await box.files.stat(path, follow ? { follow: true } : undefined);
      yield {
        type: "log",
        message: `${info.type}\t${info.size}\t${info.mod_time}\tinode ${info.inode}`,
      };
      break;
    }
    case "mkdir": {
      const path = first;
      if (!path) {
        yield { type: "log", message: "Usage: files mkdir <path> [--parents]" };
        return;
      }
      const parents = hasFlag(flags, ["--parents", "-p"]);
      await box.files.mkdir(path, parents ? { parents: true } : undefined);
      yield { type: "log", message: `Created ${path}` };
      break;
    }
    case "rename":
    case "mv": {
      const from = first;
      const to = second;
      if (!from || !to) {
        yield { type: "log", message: "Usage: files rename <from> <to>" };
        return;
      }
      await box.files.rename(from, to);
      yield { type: "log", message: `Renamed ${from} → ${to}` };
      break;
    }
    case "remove":
    case "rm": {
      const path = first;
      if (!path) {
        yield { type: "log", message: "Usage: files remove <path> [--recursive]" };
        return;
      }
      // The server refuses to remove a directory without this, rather than
      // deleting a tree because the caller was imprecise.
      const recursive = hasFlag(flags, ["--recursive", "-r"]);
      await box.files.remove(path, recursive ? { recursive: true } : undefined);
      yield { type: "log", message: `Removed ${path}` };
      break;
    }
    case "download": {
      const folder = first;
      await box.files.download(folder ? { folder } : undefined);
      yield { type: "log", message: "Downloaded." };
      break;
    }
    default:
      yield {
        type: "log",
        message:
          "Usage: files <read|write|list|stat|mkdir|rename|remove|upload|download> [args...]",
      };
  }
}

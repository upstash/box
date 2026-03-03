import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Handle file subcommands: read, write, list, upload, download.
 */
export async function* handleFiles(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const parts = args.split(/\s+/);
  const sub = parts[0];

  switch (sub) {
    case "read": {
      const path = parts[1];
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
      const path = parts[1];
      const files = await box.files.list(path);
      for (const f of files) {
        const indicator = f.is_dir ? "/" : "";
        yield { type: "log", message: `${f.name}${indicator}\t${f.size}` };
      }
      break;
    }
    case "upload": {
      const localPath = parts[1];
      const destination = parts[2];
      if (!localPath || !destination) {
        yield { type: "log", message: "Usage: files upload <local-path> <destination>" };
        return;
      }
      await box.files.upload([{ path: localPath, destination }]);
      yield { type: "log", message: `Uploaded ${localPath} → ${destination}` };
      break;
    }
    case "download": {
      const folder = parts[1];
      await box.files.download(folder ? { folder } : undefined);
      yield { type: "log", message: "Downloaded." };
      break;
    }
    default:
      yield { type: "log", message: "Usage: files <read|write|list|upload|download> [args...]" };
  }
}

import type { Box } from "@upstash/box";
import type { REPLHooks } from "../repl-client.js";

/**
 * Handle file subcommands: read, write, list, upload, download.
 */
export async function handleFiles(box: Box, args: string, hooks: REPLHooks): Promise<void> {
  const parts = args.split(/\s+/);
  const sub = parts[0];

  switch (sub) {
    case "read": {
      const path = parts[1];
      if (!path) {
        hooks.onLog("Usage: files read <path>");
        return;
      }
      const content = await box.files.read(path);
      hooks.onLog(content);
      break;
    }
    case "write": {
      const path = parts[1];
      const content = parts.slice(2).join(" ");
      if (!path || !content) {
        hooks.onLog("Usage: files write <path> <content>");
        return;
      }
      await box.files.write({ path, content });
      hooks.onLog(`Written to ${path}`);
      break;
    }
    case "list": {
      const path = parts[1];
      const files = await box.files.list(path);
      for (const f of files) {
        const indicator = f.is_dir ? "/" : "";
        hooks.onLog(`${f.name}${indicator}\t${f.size}`);
      }
      break;
    }
    case "upload": {
      const localPath = parts[1];
      const destination = parts[2];
      if (!localPath || !destination) {
        hooks.onLog("Usage: files upload <local-path> <destination>");
        return;
      }
      await box.files.upload([{ path: localPath, destination }]);
      hooks.onLog(`Uploaded ${localPath} → ${destination}`);
      break;
    }
    case "download": {
      const path = parts[1];
      await box.files.download(path ? { path } : undefined);
      hooks.onLog("Downloaded.");
      break;
    }
    default:
      hooks.onLog("Usage: files <read|write|list|upload|download> [args...]");
  }
}

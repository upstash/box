import type { Box } from "@upstash/box";

/**
 * Handle file subcommands: read, write, list, upload, download.
 */
export async function handleFiles(box: Box, args: string): Promise<void> {
  const parts = args.split(/\s+/);
  const sub = parts[0];

  switch (sub) {
    case "read": {
      const path = parts[1];
      if (!path) {
        console.log("Usage: files read <path>");
        return;
      }
      const content = await box.files.read(path);
      console.log(content);
      break;
    }
    case "write": {
      const path = parts[1];
      const content = parts.slice(2).join(" ");
      if (!path || !content) {
        console.log("Usage: files write <path> <content>");
        return;
      }
      await box.files.write({ path, content });
      console.log(`Written to ${path}`);
      break;
    }
    case "list": {
      const path = parts[1];
      const files = await box.files.list(path);
      for (const f of files) {
        const indicator = f.is_dir ? "/" : "";
        console.log(`${f.name}${indicator}\t${f.size}`);
      }
      break;
    }
    case "upload": {
      const localPath = parts[1];
      const destination = parts[2];
      if (!localPath || !destination) {
        console.log("Usage: files upload <local-path> <destination>");
        return;
      }
      await box.files.upload([{ path: localPath, destination }]);
      console.log(`Uploaded ${localPath} → ${destination}`);
      break;
    }
    case "download": {
      const path = parts[1];
      await box.files.download(path ? { path } : undefined);
      console.log("Downloaded.");
      break;
    }
    default:
      console.log("Usage: files <read|write|list|upload|download> [args...]");
  }
}

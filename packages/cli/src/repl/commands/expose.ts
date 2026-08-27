import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Public URL subcommands: create, list, delete.
 *
 * A server inside the box is not reachable from the outside until a port is
 * exposed, so this is the other half of running one — starting `npm run dev`
 * and then having no way to look at it is the common dead end.
 */
export async function* handleExpose(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0];

  switch (sub) {
    case undefined:
    case "list": {
      const { publicURLs } = await box.listPublicURLs();
      if (publicURLs.length === 0) {
        yield { type: "log", message: "No exposed ports." };
        return;
      }
      for (const entry of publicURLs) {
        yield { type: "log", message: `${String(entry.port).padEnd(6)}${entry.url}` };
      }
      break;
    }

    case "delete":
    case "remove": {
      const port = Number(parts[1]);
      if (!Number.isInteger(port) || port < 1) {
        yield { type: "log", message: "Usage: expose delete <port>" };
        return;
      }
      await box.deletePublicURL(port);
      yield { type: "log", message: `Removed the public URL for port ${port}` };
      break;
    }

    default: {
      // `expose 3000` is the common case, so a bare port is the create form.
      const port = Number(sub);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        yield {
          type: "log",
          message:
            "Usage: expose <port> [--basic-auth|--bearer-token] | expose list | expose delete <port>",
        };
        return;
      }
      const basicAuth = parts.includes("--basic-auth");
      const bearerToken = parts.includes("--bearer-token");
      const created = await box.getPublicURL(port, {
        ...(basicAuth ? { basicAuth: true } : {}),
        ...(bearerToken ? { bearerToken: true } : {}),
      });
      yield { type: "log", message: created.url };
      if (created.username) {
        yield { type: "log", message: `user: ${created.username}  password: ${created.password}` };
      }
      if (created.token) yield { type: "log", message: `bearer token: ${created.token}` };
      // Detaching matters: a server started as a plain background job is reaped
      // when the command that launched it finishes, and the URL then 502s.
      yield {
        type: "log",
        message: "Start the server detached — ( npm run dev & ) — or it stops with the command.",
      };
    }
  }
}

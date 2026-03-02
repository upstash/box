import { Box } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { startRepl } from "../repl/terminal.js";
import { interactiveSelect } from "../utils/interactive-select.js";
import { dim } from "../utils/ansi.js";

interface ConnectFlags {
  token?: string;
}

export async function connectCommand(
  boxId: string | undefined,
  flags: ConnectFlags,
): Promise<void> {
  const apiKey = resolveToken(flags.token);

  let targetId = boxId;

  // If no box ID provided, pick interactively or fall back to most recent
  if (!targetId) {
    const boxes = await Box.list({ apiKey });
    const active = boxes.filter((b) => b.status !== "deleted");
    if (active.length === 0) {
      console.error("No boxes found.");
      process.exit(1);
    }

    if (process.stdin.isTTY && active.length > 1) {
      const items = active.slice(0, 10);
      const idWidth = Math.max(...items.map((b) => b.id.length));
      const nameWidth = Math.max(...items.map((b) => (b.name ?? "").length), 0);
      const statusWidth = Math.max(...items.map((b) => b.status.length));

      const selected = await interactiveSelect({
        prompt: "Select a box to connect to:",
        items: items.map((b) => {
          const name = b.name ? `  ${b.name.padEnd(nameWidth)}` : nameWidth > 0 ? `  ${"".padEnd(nameWidth)}` : "";
          return {
            label: `${b.id.padEnd(idWidth)}${name}`,
            value: b.id,
            description: `${b.status.padEnd(statusWidth)}  ${b.model ?? ""}`,
          };
        }),
      });

      if (!selected) {
        console.log(dim("Aborted."));
        return;
      }
      targetId = selected;
    } else {
      if (active.length === 1) {
        console.log("Only one box found, using it...");
      } else {
        console.log("No box ID specified, connecting to most recent...");
      }
      targetId = active[0]!.id;
    }
  }

  console.log(`\nConnecting to box ${targetId}...`);
  const box = await Box.get(targetId, { apiKey });
  await startRepl(box);
}

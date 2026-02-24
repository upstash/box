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
    if (boxes.length === 0) {
      console.error("No boxes found.");
      process.exit(1);
    }

    if (process.stdin.isTTY && boxes.length > 1) {
      const selected = await interactiveSelect({
        prompt: "Select a box to connect to:",
        items: boxes.slice(0, 10).map((b) => ({
          label: b.id,
          value: b.id,
          description: `${b.status}${b.model ? ` · ${b.model}` : ""}`,
        })),
      });

      if (!selected) {
        console.log(dim("Aborted."));
        return;
      }
      targetId = selected;
    } else {
      console.log("No box ID specified, connecting to most recent...");
      targetId = boxes[0]!.id;
    }
  }

  console.log(`Connecting to box ${targetId}...`);
  const box = await Box.get(targetId, { apiKey });
  await startRepl(box);
}

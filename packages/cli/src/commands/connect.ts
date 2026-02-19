import { Box } from "@buggyhunter/box";
import { resolveToken } from "../auth.js";
import { startRepl } from "../repl.js";

interface ConnectFlags {
  token?: string;
}

export async function connectCommand(boxId: string | undefined, flags: ConnectFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);

  let targetId = boxId;

  // If no box ID provided, connect to most recent
  if (!targetId) {
    console.log("No box ID specified, connecting to most recent...");
    const boxes = await Box.list({ apiKey });
    if (boxes.length === 0) {
      console.error("No boxes found.");
      process.exit(1);
    }
    targetId = boxes[0]!.id;
  }

  console.log(`Connecting to box ${targetId}...`);
  const box = await Box.get(targetId, { apiKey });
  await startRepl(box);
}

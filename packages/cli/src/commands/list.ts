import { Box } from "@buggyhunter/box";
import { resolveToken } from "../auth.js";
import { formatJSON } from "../output.js";

interface ListFlags {
  token?: string;
}

export async function listCommand(flags: ListFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const boxes = await Box.list({ apiKey });

  if (boxes.length === 0) {
    console.log("No boxes found.");
    return;
  }

  for (const b of boxes) {
    console.log(`${b.id}\t${b.status}\t${b.model}\t${b.created_at}`);
  }
}

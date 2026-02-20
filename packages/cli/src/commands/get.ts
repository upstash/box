import { Box } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { formatJSON } from "../output.js";

interface GetFlags {
  token?: string;
}

export async function getCommand(boxId: string, flags: GetFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const box = await Box.get(boxId, { apiKey });
  console.log(formatJSON({ id: box.id }));
}

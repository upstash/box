import { Box } from "@upstash/box";
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

  const headers = ["ID", "STATUS", "MODEL", "CREATED"];
  const rows = boxes.map((b) => [b.id, b.status, b.model ?? "", String(b.created_at)]);

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length))
  );

  const formatRow = (row: string[]) =>
    row.map((val, i) => val.padEnd(colWidths[i]!)).join("  ");

  console.log(formatRow(headers));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

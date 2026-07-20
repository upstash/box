import { Box } from "@upstash/box";
import { resolveToken } from "../auth.js";
import { formatJSON } from "../output.js";

interface ListFlags {
  token?: string;
  label?: string;
}

export async function listCommand(flags: ListFlags): Promise<void> {
  const apiKey = resolveToken(flags.token);
  const boxes = await Box.list({ apiKey, label: flags.label });

  if (boxes.length === 0) {
    console.log(flags.label ? `No boxes found with label "${flags.label}".` : "No boxes found.");
    return;
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts < 1e12 ? ts * 1000 : ts);
    const time = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${time} ${date}`;
  };

  const headers = ["ID", "STATUS", "MODEL", "CREATED", "NAME", "LABELS"];
  const rows = boxes.map((b) => [
    b.id,
    b.status,
    b.model ?? "",
    formatDate(b.created_at),
    b.name ?? "",
    (b.labels ?? []).join(", "),
  ]);

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));

  const formatRow = (row: string[]) => row.map((val, i) => val.padEnd(colWidths[i]!)).join("  ");

  console.log(formatRow(headers));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

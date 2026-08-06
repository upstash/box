import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";

// Guide 3, example 3: crawl a site into an embedding-ready starter dataset.
// Docs sites are often client-rendered; reading through a real browser
// reliably captures what the reader sees. tab.content() returns the rendered
// title, text, and links, so a small crawl loop turns a site section into
// chunked JSONL for an embedding pipeline. No AI calls anywhere: reading
// rendered pages costs no model tokens, only browser compute.

const START_URL = "https://upstash.com/docs/qstash";
const SCOPE = "/docs/qstash";
const MAX_PAGES = 8;
const CHUNK_SIZE = 1000;
const OVERLAP = 120;

// Same origin, in-scope path, no hash/query, no trailing-slash duplicates.
const origin = new URL(START_URL).origin;
function normalize(raw: string): string | null {
  try {
    const u = new URL(raw, START_URL);
    if (u.origin !== origin || !u.pathname.startsWith(SCOPE)) return null;
    return origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const box = await Box.create({ runtime: "node", browser: true });

try {
  const tab = await box.browser.tab.create(START_URL, { waitUntil: "domcontentloaded" });

  // Explicit readiness: client-rendered pages may hydrate after
  // domcontentloaded, so re-read until the text settles.
  async function readSettled(url?: string) {
    let page = url ? await tab.goto(url) : await tab.content();
    for (let attempt = 0; attempt < 3 && page.text.trim().length < 300; attempt++) {
      await new Promise((r) => setTimeout(r, 700));
      page = await tab.content();
    }
    return page;
  }

  const queue = [normalize(START_URL)!];
  const seen = new Set<string>();
  const records: Record<string, unknown>[] = [];
  const errors: { url: string; error: string }[] = [];

  while (queue.length && seen.size < MAX_PAGES) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    try {
      const page = await readSettled(seen.size === 1 ? undefined : url);

      // Chunk with overlap; merge a tiny tail into the previous chunk
      // instead of dropping it.
      const text = page.text.replace(/\s+/g, " ").trim();
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += CHUNK_SIZE - OVERLAP) {
        chunks.push(text.slice(i, i + CHUNK_SIZE));
        if (i + CHUNK_SIZE >= text.length) break;
      }
      if (chunks.length > 1 && chunks.at(-1)!.length < 200) {
        const tail = chunks.pop()!;
        chunks[chunks.length - 1] += tail.slice(OVERLAP);
      }

      for (const [n, chunk] of chunks.entries()) {
        records.push({
          chunkId: `${url}#${n}`,
          url,
          title: page.title,
          sha256: createHash("sha256").update(chunk).digest("hex"),
          text: chunk,
        });
      }
      console.log(`crawled ${url} (${text.length} chars, ${chunks.length} chunks)`);

      for (const link of page.links ?? []) {
        const next = normalize(link.href);
        if (next && !seen.has(next)) queue.push(next);
      }
    } catch (err) {
      // One bad page must not abort the crawl.
      errors.push({ url, error: (err as Error).message.slice(0, 120) });
      console.log(`failed ${url}, continuing`);
    }
  }

  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
  await writeFile("dataset.jsonl", jsonl);
  if (errors.length) console.log("errors:", JSON.stringify(errors));
  console.log(
    `\ndataset.jsonl: ${records.length} chunks from ${seen.size - errors.length}/${seen.size} pages, ` +
      `${Math.round(jsonl.length / 1024)} KB — a starter dataset for your embedding pipeline`,
  );
} finally {
  await box.delete();
}

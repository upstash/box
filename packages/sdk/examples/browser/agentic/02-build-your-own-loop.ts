import { writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { z } from "zod/v3";

// Agentic browsing, your own loop.
// Stagehand v4's other replacement for the removed agent loop: keep the model in
// the loop and own the control flow. Unlike 02-ai-compiled-scraper (which reads
// the layout ONCE, then scrapes deterministically with Playwright and no more
// AI), the model still runs here on every page. Resolve the product links once
// with observe, then for each: reset to the listing (deterministic goto, no
// browser-AI tokens), replay the resolved click with no LLM (act(action)), and
// extract the product. extract is the loop's stop check.

const START = "https://books.toscrape.com/";
const GOAL = 5;

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  runtime: "node",
  browser: true,
});

try {
  const tab = await box.browser.tab.create(START, { waitUntil: "domcontentloaded" });

  // Resolve the product links ONCE (metered), keeping those with a selector so
  // act() can replay each click. The listing exposes two links per book (cover +
  // title), so we dedupe by title and stop once we have GOAL distinct books.
  const { elements } = await tab.observe("the book product links in the listing");
  const actions = elements.filter((e) => e.selector);

  const books: Array<{ title: string; price: string; stock: string }> = [];
  const seen = new Set<string>();
  for (const action of actions) {
    if (books.length >= GOAL) break; // stop once we have enough distinct books

    await tab.goto(START); // deterministic reset, no browser-AI tokens
    await tab.act(action); // replay the resolved click: no LLM, no tokens

    const book = await tab.extract(
      "the book title, price, and availability text on this product page",
      z.object({
        title: z.string().nullable(),
        price: z.string().nullable(),
        stock: z.string().nullable(),
      }),
    );
    if (!book.title || !book.price) continue; // not a product page
    if (seen.has(book.title)) continue; // skip the duplicate cover/title link
    seen.add(book.title);
    books.push({ title: book.title, price: book.price, stock: book.stock ?? "" });
  }

  await writeFile("books.json", JSON.stringify(books, null, 2));
  console.log(`collected ${books.length}/${GOAL} books`);
} finally {
  await box.delete();
}

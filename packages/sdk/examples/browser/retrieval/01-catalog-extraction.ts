import { writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { z } from "zod/v3";

// Guide 3, example 1: structured extraction from a rendered page.
// The onboarding example: one AI call, schema-validated, typed output, with
// a screenshot as provenance. The page renders in a real browser, so the
// same call works unchanged on client-rendered sites (this sandbox happens
// to be static — the technique is what transfers).

const PAGE_URL = "https://books.toscrape.com";

const box = await Box.create({ runtime: "node", browser: true });

try {
  const tab = await box.browser.tab.create(PAGE_URL, { waitUntil: "domcontentloaded" });

  const { books } = await tab.extract(
    "Extract every book on this page: title, price, availability, and image URL.",
    z.object({
      books: z
        .array(
          z.object({
            title: z.string().min(1),
            price: z.string().regex(/£\d/),
            availability: z.string(),
            imageUrl: z.string(),
          }),
        )
        .min(10),
    }),
  );

  // Image URLs on listing pages are usually relative — normalize them.
  for (const book of books) book.imageUrl = new URL(book.imageUrl, PAGE_URL).href;

  console.log(`extracted ${books.length} books from this page, typed and validated:`);
  for (const book of books.slice(0, 3)) {
    console.log(`  ${book.title} — ${book.price} (${book.availability})`);
  }

  // Keep a visual record of what the data came from.
  const png = await tab.screenshot({ fullPage: true });
  await writeFile("catalog.png", png);
  console.log(`page screenshot saved to catalog.png (${png.byteLength} bytes)`);

  // When you need imperative control instead, the same browser is one
  // connection away: chromium.connectOverCDP(await box.browser.cdpUrl()).
} finally {
  await box.delete();
}

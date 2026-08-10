import { readFile, writeFile } from "node:fs/promises";
import { Box } from "@upstash/box";
import { chromium } from "playwright-core";
import { z } from "zod/v3";

// Guide 3, example 2: the AI-compiled scraper.
// The AI's job is not to read pages — it is to read the layout ONCE and emit
// selectors. Every page after that is scraped deterministically with zero
// additional model tokens (browser compute still applies). This example
// deliberately reuses one box across runs: the compiled recipe is cached on
// the box filesystem, so the box carries its own knowledge. If the site's
// layout changes, validation fails and the recipe recompiles itself.

const PAGE = (n: number) => `https://books.toscrape.com/catalogue/page-${n}.html`;
const PAGES = 3;
const PAGE_SIZE = 20; // books.toscrape lists exactly 20 books per page
const RECIPE_PATH = "recipe-books.json";
const BOX_ID_FILE = ".box-compiled-scraper";

const FieldSpec = z.object({ selector: z.string(), attr: z.string().min(1) });
const RecipeSchema = z.object({
  itemSelector: z.string().min(1),
  title: FieldSpec,
  price: FieldSpec,
});
const RecipeFileSchema = RecipeSchema.extend({
  version: z.literal(1),
  host: z.string(),
  compiledAt: z.string(),
});
type Recipe = z.infer<typeof RecipeSchema>;

// One persistent box: it pauses when idle and resumes on demand, keeping the
// cached recipe with it. The box remains (and bills) until you delete it —
// when done with the target site: Box.get(id).delete() and remove the id file.
let box: Box;
try {
  box = await Box.get((await readFile(BOX_ID_FILE, "utf8")).trim());
} catch {
  box = await Box.create({ runtime: "node", browser: true });
  await writeFile(BOX_ID_FILE, box.id);
}

async function compile(): Promise<Recipe> {
  console.log("compiling recipe (one metered call)...");
  const tab = await box.browser.tab.create(PAGE(1), { waitUntil: "domcontentloaded" });
  try {
    return await tab.extract(
      [
        "You are compiling a scraper for the repeating list of books.",
        "Return `itemSelector`: a CSS selector matching each book's container.",
        "Return `title` and `price` field specs: each with a CSS `selector`",
        'RELATIVE to the container and `attr` ("text" or an attribute name).',
        "If the visible text is truncated, prefer an attribute holding the",
        "full value (such as an anchor's title attribute).",
        "Selectors must be generic, no :nth-child tied to one item.",
      ].join(" "),
      RecipeSchema,
    );
  } finally {
    await tab.close();
  }
}

// Deterministic harvest: same recipe, every page, zero model tokens.
async function scrape(recipe: Recipe) {
  const browser = await chromium.connectOverCDP(await box.browser.cdpUrl());
  const items: { title: string | null; price: string | null }[] = [];
  try {
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = await ctx.newPage();
    for (let n = 1; n <= PAGES; n++) {
      await page.goto(PAGE(n), { waitUntil: "domcontentloaded" });
      items.push(
        ...(await page.$$eval(
          recipe.itemSelector,
          (rows, fields: { title: Recipe["title"]; price: Recipe["price"] }) =>
            rows.map((row) => {
              const read = (field: { selector: string; attr: string }) => {
                const el = field.selector ? row.querySelector(field.selector) : row;
                if (!el) return null;
                if (field.attr === "text") return el.textContent?.trim() ?? null;
                return el.getAttribute(field.attr);
              };
              return { title: read(fields.title), price: read(fields.price) };
            }),
          { title: recipe.title, price: recipe.price },
        )),
      );
    }
    await page.close();
  } finally {
    await browser.close();
  }
  return items;
}

// A stale or bad recipe must fail loudly, never cache silently.
function validate(items: { title: string | null; price: string | null }[]) {
  const expected = PAGES * PAGE_SIZE;
  if (items.length !== expected) return `expected ${expected} items, got ${items.length}`;
  if (!items.every((i) => i.title && i.title.length > 3)) return "empty or truncated titles";
  if (!items.every((i) => i.price && /^£\d+\.\d{2}$/.test(i.price))) return "malformed prices";
  return null;
}

// Load the box-cached recipe, or compile and cache one. A missing file is
// the normal first run; an unparseable one means the format changed.
let recipe: Recipe | undefined;
let usedAI = false;
let cachedRaw: string | undefined;
try {
  cachedRaw = await box.files.read(RECIPE_PATH);
} catch {
  console.log("no recipe cached yet — first run compiles one");
}
if (cachedRaw !== undefined) {
  try {
    const cached = RecipeFileSchema.parse(JSON.parse(cachedRaw));
    console.log(`using recipe cached in the box (compiled ${cached.compiledAt}) — no AI this run`);
    recipe = cached;
  } catch {
    console.log("cached recipe no longer matches the expected format, recompiling");
  }
}
if (!recipe) {
  usedAI = true;
  recipe = await compile();
}

let items = await scrape(recipe);
let problem = validate(items);

if (problem && !usedAI) {
  console.log(`cached recipe went stale (${problem}), recompiling...`);
  recipe = await compile();
  usedAI = true;
  items = await scrape(recipe);
  problem = validate(items);
}
if (problem) throw new Error(`freshly compiled recipe still fails validation: ${problem}`);

if (usedAI) {
  await box.files.write({
    path: RECIPE_PATH,
    content: JSON.stringify(
      { version: 1, host: new URL(PAGE(1)).hostname, compiledAt: new Date().toISOString(), ...recipe },
      null,
      2,
    ),
  });
  console.log("validated recipe cached in the box");
}

console.log(`${items.length} books from ${PAGES} pages via ${usedAI ? "fresh compile" : "cached recipe"}`);
console.log("sample:", JSON.stringify(items[0]));

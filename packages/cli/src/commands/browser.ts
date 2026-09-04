import { writeFileSync } from "node:fs";
import { Box, type Tab } from "@upstash/box";
import { resolveBoxId, announceBox } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, note, requireToken, type GlobalFlags } from "../core/io.js";

export type BrowserFlags = GlobalFlags & {
  tab?: string;
  out?: string;
  fullPage?: boolean;
};

async function open(flags: BrowserFlags): Promise<Box> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);
  return Box.get(resolved.id, { apiKey: requireToken(flags.token) });
}

/**
 * Resolve which tab to act on.
 *
 * A box can hold several tabs, and every page operation is addressed by one.
 * With a single tab open, requiring --tab would be ceremony; with several,
 * guessing would act on the wrong page.
 * @param box - the box.
 * @param flags - the merged flags, for --tab.
 * @returns the tab to use.
 * @throws CliError when there is nothing open, or the choice is ambiguous.
 */
async function resolveTab(box: Box, flags: BrowserFlags): Promise<Tab> {
  if (flags.tab) return box.browser.getTab(flags.tab);

  const tabs = await box.browser.listTabs();
  if (tabs.length === 0) {
    throw new CliError("No open tabs. Open one with: box browser open <url>");
  }
  if (tabs.length > 1) {
    throw new CliError(
      `${tabs.length} tabs are open; name one with --tab <id>. List them with: box browser tabs`,
    );
  }
  return tabs[0]!;
}

/**
 * Open a URL in the box's browser.
 * @param url - the page to load.
 * @param flags - the merged flags.
 */
export async function browserOpenCommand(url: string, flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const tab = await box.browser.tab.create(url);
  emit({ tab_id: tab.id, url }, [tab.id], flags);
}

/**
 * List the open tabs.
 * @param flags - the merged flags.
 */
export async function browserTabsCommand(flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const tabs = await box.browser.listTabs();
  const data = tabs.map((tab) => ({ id: tab.id, url: tab.url, title: tab.title }));
  emit(
    data,
    tabs.length === 0
      ? ["No open tabs."]
      : tabs.map((tab) => `${tab.id}\t${tab.url ?? ""}\t${tab.title ?? ""}`),
    flags,
  );
}

/**
 * Read the active page: title, visible text and links.
 * @param flags - the merged flags.
 */
export async function browserContentCommand(flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const tab = await resolveTab(box, flags);
  const content = await tab.content();
  emit(content, [content.title, content.url, "", content.text], flags);
}

/**
 * Capture the page as a PNG.
 *
 * The image goes to a file rather than stdout: stdout carries text that a
 * caller may pipe, and PNG bytes down the same channel would corrupt it.
 * @param flags - the merged flags, with --out for the destination.
 */
export async function browserScreenshotCommand(flags: BrowserFlags): Promise<void> {
  if (!flags.out) {
    throw new CliError("--out <file> is required: a PNG cannot share stdout with text output");
  }

  const box = await open(flags);
  const tab = await resolveTab(box, flags);
  const shot = await tab.screenshot({ ...(flags.fullPage ? { fullPage: true } : {}) });
  const bytes = typeof shot === "string" ? Buffer.from(shot, "base64") : Buffer.from(shot);
  writeFileSync(flags.out, bytes);

  emit(
    { path: flags.out, bytes: bytes.length },
    [`Wrote ${bytes.length} bytes to ${flags.out}`],
    flags,
  );
}

/**
 * Act on the page in natural language ("click the login button").
 * @param instruction - what to do.
 * @param flags - the merged flags.
 */
export async function browserActCommand(instruction: string, flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const tab = await resolveTab(box, flags);
  const result = await tab.act(instruction);
  emit(result, [typeof result === "string" ? result : JSON.stringify(result, undefined, 2)], flags);
}

/**
 * Close a tab.
 * @param flags - the merged flags.
 */
export async function browserCloseCommand(flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const tab = await resolveTab(box, flags);
  await tab.close();
  emit({ tab_id: tab.id, closed: true }, [`Closed ${tab.id}`], flags);
}

/**
 * Print the CDP URL, so Playwright or Puppeteer can drive the same browser.
 * @param flags - the merged flags.
 */
export async function browserCdpUrlCommand(flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const url = await box.browser.cdpUrl();
  note("Connect with: chromium.connectOverCDP(<url>)");
  emit({ cdp_url: url }, [url], flags);
}

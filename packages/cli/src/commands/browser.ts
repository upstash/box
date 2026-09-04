import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { Box, type Tab } from "@upstash/box";
import { resolveBoxId, announceBox } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, note, requireToken, type GlobalFlags } from "../core/io.js";

export type BrowserFlags = GlobalFlags & {
  tab?: string;
  out?: string;
  fullPage?: boolean;
  schema?: string;
  maxSeconds?: string;
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
  const links = content.links ?? [];
  emit(
    content,
    [
      content.title,
      content.url,
      "",
      content.text,
      // The command says it reads links, so the default output has to carry
      // them; without this only --json exposed a destination URL.
      ...(links.length === 0
        ? []
        : ["", ...links.map((link) => `${link.text ?? ""}\t${link.href ?? ""}`)]),
    ],
    flags,
  );
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

/**
 * Navigate an existing tab.
 * @param url - where to go.
 * @param flags - the merged flags.
 */
export async function browserGotoCommand(url: string, flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const tab = await resolveTab(box, flags);
  const content = await tab.goto(url);
  emit(content, [content.title, content.url], flags);
}

/**
 * List the actions available on the page.
 * @param instruction - what to look for.
 * @param flags - the merged flags.
 */
export async function browserObserveCommand(
  instruction: string,
  flags: BrowserFlags,
): Promise<void> {
  const box = await open(flags);
  const tab = await resolveTab(box, flags);
  const result = await tab.observe(instruction);
  emit(result, [JSON.stringify(result, undefined, 2)], flags);
}

/**
 * Build a Zod object from a flat JSON Schema.
 *
 * `extract` takes a Zod schema, which cannot travel through a command line, so
 * the CLI accepts the JSON Schema an agent can write to a file. Only a flat
 * object of scalars and string arrays converts; anything nested is refused
 * rather than silently dropped, because a field that vanishes from the schema
 * comes back as a missing key rather than as an error.
 * @param path - file holding the JSON Schema.
 * @returns the equivalent Zod object.
 */
function schemaFromFile(path: string): z.ZodTypeAny {
  let parsed: {
    type?: string;
    properties?: Record<string, { type?: string; items?: { type?: string } }>;
  } | null;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as typeof parsed;
  } catch (error) {
    throw new CliError(`Could not read the schema at ${path}: ${(error as Error).message}`);
  }

  // JSON.parse("null") succeeds, and reading .type off the result is a raw
  // TypeError rather than the message the caller needs.
  if (parsed === null || typeof parsed !== "object") {
    throw new CliError('The schema must be {"type":"object","properties":{...}}');
  }
  if (parsed.type !== "object" || !parsed.properties) {
    throw new CliError('The schema must be {"type":"object","properties":{...}}');
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(parsed.properties)) {
    switch (prop.type) {
      case "string":
        shape[key] = z.string();
        break;
      case "number":
      case "integer":
        shape[key] = z.number();
        break;
      case "boolean":
        shape[key] = z.boolean();
        break;
      case "array":
        if (prop.items?.type !== "string") {
          throw new CliError(`Field ${key}: only arrays of string are supported`);
        }
        shape[key] = z.array(z.string());
        break;
      default:
        throw new CliError(`Field ${key}: unsupported type ${prop.type ?? "(missing)"}`);
    }
  }
  return z.object(shape);
}

/**
 * Pull structured data off the page against a schema.
 * @param instruction - what to extract.
 * @param flags - the merged flags; --schema names a JSON Schema file.
 */
export async function browserExtractCommand(
  instruction: string,
  flags: BrowserFlags,
): Promise<void> {
  if (!flags.schema) {
    throw new CliError("--schema <file.json> is required, holding a flat JSON Schema object");
  }

  const box = await open(flags);
  const tab = await resolveTab(box, flags);
  const result = await tab.extract(instruction, schemaFromFile(flags.schema) as never);
  emit(result, [JSON.stringify(result, undefined, 2)], flags);
}

/**
 * Print the live-view URL for a tab, to watch it in a browser.
 * @param flags - the merged flags.
 */
export async function browserLiveUrlCommand(flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const tab = await resolveTab(box, flags);
  const url = await tab.liveViewUrl();
  emit({ live_view_url: url }, [url], flags);
}

/**
 * Start recording the browser session.
 * @param flags - the merged flags.
 */
export async function recordingStartCommand(flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const seconds = flags.maxSeconds === undefined ? undefined : Number(flags.maxSeconds);
  if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0)) {
    throw new CliError("--max-seconds must be a positive number");
  }

  const handle = await box.browser.recordings.start(
    seconds === undefined ? undefined : { maxDurationSeconds: seconds },
  );
  emit(handle, [handle.id ?? "recording started"], flags);
}

/**
 * Stop the active recording.
 * @param flags - the merged flags.
 */
export async function recordingStopCommand(flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const result = await box.browser.recordings.stop();
  emit(result, [result?.id ?? "recording stopped"], flags);
}

/**
 * List recordings.
 * @param flags - the merged flags.
 */
export async function recordingListCommand(flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const recordings = await box.browser.recordings.list();
  emit(
    recordings,
    recordings.length === 0
      ? ["No recordings."]
      : recordings.map((rec) => `${rec.id}\t${rec.status ?? ""}`),
    flags,
  );
}

/**
 * Show one recording.
 * @param recordingId - which recording.
 * @param flags - the merged flags.
 */
export async function recordingGetCommand(recordingId: string, flags: BrowserFlags): Promise<void> {
  const box = await open(flags);
  const recording = await box.browser.recordings.get(recordingId);
  emit(recording, [JSON.stringify(recording, undefined, 2)], flags);
}

/**
 * Download a recording to a file.
 * @param recordingId - which recording.
 * @param flags - the merged flags; --out names the destination.
 */
export async function recordingDownloadCommand(
  recordingId: string,
  flags: BrowserFlags,
): Promise<void> {
  if (!flags.out) {
    throw new CliError("--out <file> is required: video bytes cannot share stdout with text");
  }

  const box = await open(flags);
  await box.browser.recordings.download(recordingId, { path: flags.out });
  emit({ id: recordingId, path: flags.out }, [`Downloaded to ${flags.out}`], flags);
}

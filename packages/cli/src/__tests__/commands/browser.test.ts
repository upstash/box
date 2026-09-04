import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserOpenCommand,
  browserTabsCommand,
  browserContentCommand,
  browserScreenshotCommand,
  browserActCommand,
  browserCloseCommand,
  browserCdpUrlCommand,
} from "../../commands/browser.js";
import { CliError } from "../../core/errors.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

vi.mock("../../core/box-ref.js", () => ({
  resolveBoxId: vi.fn(() => ({ id: "b1", source: "flag" })),
  announceBox: vi.fn(),
}));

describe("box browser", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  const flags = { box: "b1", token: "box_test" };

  const written = () => stdout.mock.calls.map((c) => String(c[0])).join("");

  /** A box whose browser namespace is backed by the given fakes. */
  const boxWith = (browser: Record<string, unknown>) => {
    getBox.mockResolvedValue({ browser });
    return browser;
  };

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    getBox.mockReset();
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("prints the tab id on open, so later commands can address it", async () => {
    const create = vi.fn().mockResolvedValue({ id: "tab-7" });
    boxWith({ tab: { create } });

    await browserOpenCommand("https://example.com", { ...flags });

    expect(create).toHaveBeenCalledWith("https://example.com");
    expect(written()).toContain("tab-7");
  });

  it("lists tabs as data, not as SDK objects", async () => {
    // A real Tab holds a back-reference to the Box, so emitting one raw is a
    // circular structure that JSON.stringify throws on. Model that here, or
    // the projection looks unnecessary.
    const fakeTab = (id: string, url: string, title: string) => {
      const tab: Record<string, unknown> = { id, url, title, content: vi.fn() };
      tab.box = { id: "b1", tabs: [tab] };
      return tab;
    };
    boxWith({
      listTabs: vi
        .fn()
        .mockResolvedValue([
          fakeTab("tab-1", "https://a.test", "A"),
          fakeTab("tab-2", "https://b.test", "B"),
        ]),
    });

    await browserTabsCommand({ ...flags, json: true });

    // A Tab instance carries methods and a back-reference to the box; emitting
    // it raw would put that in --json output.
    expect(JSON.parse(written())).toEqual([
      { id: "tab-1", url: "https://a.test", title: "A" },
      { id: "tab-2", url: "https://b.test", title: "B" },
    ]);
  });

  it("uses the only open tab without being told", async () => {
    const content = vi.fn().mockResolvedValue({ title: "T", url: "u", text: "hello" });
    boxWith({ listTabs: vi.fn().mockResolvedValue([{ id: "tab-1", content }]) });

    await browserContentCommand({ ...flags });

    expect(content).toHaveBeenCalled();
    expect(written()).toContain("hello");
  });

  it("prints the links, which the description promises", async () => {
    // Without this only --json exposed a destination URL, so the default output
    // did not match what the command says it reads.
    const content = vi.fn().mockResolvedValue({
      title: "T",
      url: "u",
      text: "body",
      links: [{ text: "Docs", href: "https://docs.test" }],
    });
    boxWith({ listTabs: vi.fn().mockResolvedValue([{ id: "tab-1", content }]) });

    await browserContentCommand({ ...flags });

    expect(written()).toContain("https://docs.test");
  });

  it("refuses to guess when several tabs are open", async () => {
    boxWith({ listTabs: vi.fn().mockResolvedValue([{ id: "tab-1" }, { id: "tab-2" }]) });

    // Acting on the wrong page is worse than asking which one.
    await expect(browserContentCommand({ ...flags })).rejects.toThrow(/--tab/);
  });

  it("says what to do when nothing is open", async () => {
    boxWith({ listTabs: vi.fn().mockResolvedValue([]) });

    await expect(browserContentCommand({ ...flags })).rejects.toThrow(/browser open/);
  });

  it("addresses the named tab directly, without listing", async () => {
    const listTabs = vi.fn();
    const content = vi.fn().mockResolvedValue({ title: "T", url: "u", text: "x" });
    boxWith({ listTabs, getTab: vi.fn(() => ({ id: "tab-9", content })) });

    await browserContentCommand({ ...flags, tab: "tab-9" });

    expect(listTabs).not.toHaveBeenCalled();
    expect(content).toHaveBeenCalled();
  });

  describe("screenshot", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "box-shot-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("writes the PNG to the file it was given", async () => {
      const png = new Uint8Array([137, 80, 78, 71]);
      boxWith({
        listTabs: vi
          .fn()
          .mockResolvedValue([{ id: "t", screenshot: vi.fn().mockResolvedValue(png) }]),
      });
      const out = join(dir, "page.png");

      await browserScreenshotCommand({ ...flags, out });

      expect([...readFileSync(out)]).toEqual([137, 80, 78, 71]);
    });

    it("requires --out rather than putting bytes on stdout", async () => {
      // stdout is the data channel for text; PNG bytes would corrupt a pipe.
      boxWith({ listTabs: vi.fn().mockResolvedValue([{ id: "t" }]) });

      await expect(browserScreenshotCommand({ ...flags })).rejects.toThrow(CliError);
    });

    it("decodes a base64 screenshot rather than writing the string", async () => {
      const b64 = Buffer.from([1, 2, 3]).toString("base64");
      boxWith({
        listTabs: vi
          .fn()
          .mockResolvedValue([{ id: "t", screenshot: vi.fn().mockResolvedValue(b64) }]),
      });
      const out = join(dir, "page.png");

      await browserScreenshotCommand({ ...flags, out });

      expect([...readFileSync(out)]).toEqual([1, 2, 3]);
    });
  });

  it("passes the instruction through to act", async () => {
    const act = vi.fn().mockResolvedValue({ success: true });
    boxWith({ listTabs: vi.fn().mockResolvedValue([{ id: "t", act }]) });

    await browserActCommand("click the login button", { ...flags });

    expect(act).toHaveBeenCalledWith("click the login button");
  });

  it("closes the tab", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    boxWith({ listTabs: vi.fn().mockResolvedValue([{ id: "tab-3", close }]) });

    await browserCloseCommand({ ...flags });

    expect(close).toHaveBeenCalled();
    expect(written()).toContain("tab-3");
  });

  it("prints the CDP url on stdout and the hint on stderr", async () => {
    boxWith({ cdpUrl: vi.fn().mockResolvedValue("ws://cdp.test/abc") });

    await browserCdpUrlCommand({ ...flags });

    // The URL is the data; the how-to is a diagnostic, so a pipe stays clean.
    expect(written()).toContain("ws://cdp.test/abc");
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toContain("connectOverCDP");
  });
});

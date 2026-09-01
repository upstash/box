import { describe, it, expect, vi } from "vitest";
import { handlePublicUrl } from "../../../repl/commands/public-url.js";
import { collectEvents } from "../helpers.js";

describe("handlePublicUrl", () => {
  function createMockBox() {
    return {
      id: "box-1",
      getPublicURL: vi.fn().mockResolvedValue({ url: "https://box-1-3000.preview", port: 3000 }),
      listPublicURLs: vi
        .fn()
        .mockResolvedValue({ publicURLs: [{ url: "https://box-1-3000.preview", port: 3000 }] }),
      deletePublicURL: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("treats a bare port as the create form", async () => {
    const box = createMockBox();
    const events = await collectEvents(handlePublicUrl(box as any, "3000"));
    expect(box.getPublicURL).toHaveBeenCalledWith(3000, {});
    expect(events[0]).toEqual({ type: "log", message: "https://box-1-3000.preview" });
  });

  it("warns that a server must be detached to survive the command", async () => {
    // A plain background job is reaped when the exec finishes and the URL 502s,
    // which reads as a broken preview rather than a wrong command.
    const events = await collectEvents(handlePublicUrl(createMockBox() as any, "3000"));
    expect(events.some((e) => String(e.message).includes("detached"))).toBe(true);
  });

  it("returns basic-auth credentials when asked", async () => {
    const box = createMockBox();
    box.getPublicURL.mockResolvedValue({
      url: "https://box-1-3000.preview",
      port: 3000,
      username: "user",
      password: "secret",
    });
    const events = await collectEvents(handlePublicUrl(box as any, "3000 --basic-auth"));
    expect(box.getPublicURL).toHaveBeenCalledWith(3000, { basicAuth: true });
    expect(events.some((e) => String(e.message).includes("user: user"))).toBe(true);
  });

  it("lists the public URLs, and with no argument", async () => {
    const box = createMockBox();
    for (const args of ["list", ""]) {
      const events = await collectEvents(handlePublicUrl(box as any, args));
      expect(String(events[0]?.message)).toContain("3000");
    }
  });

  it("says so when there are none", async () => {
    const box = createMockBox();
    box.listPublicURLs.mockResolvedValue({ publicURLs: [] });
    const events = await collectEvents(handlePublicUrl(box as any, "list"));
    expect(events[0]).toEqual({ type: "log", message: "No public URLs." });
  });

  it("deletes by port", async () => {
    const box = createMockBox();
    await collectEvents(handlePublicUrl(box as any, "delete 3000"));
    expect(box.deletePublicURL).toHaveBeenCalledWith(3000);
  });

  it("rejects a port that is not a number or out of range", async () => {
    const box = createMockBox();
    for (const args of ["notaport", "70000", "0"]) {
      const events = await collectEvents(handlePublicUrl(box as any, args));
      expect(String(events[0]?.message)).toContain("Usage: public-url");
    }
    expect(box.getPublicURL).not.toHaveBeenCalled();
  });

  describe("port bounds", () => {
    it("refuses an impossible port on delete, as it does on create", async () => {
      const box = {
        deletePublicURL: vi.fn(),
        getPublicURL: vi.fn(),
        listPublicURLs: vi.fn(),
      };
      const events = await collectEvents(handlePublicUrl(box as any, "delete 70000"));
      expect(String(events[0]?.message)).toContain("Usage: public-url delete");
      expect(box.deletePublicURL).not.toHaveBeenCalled();
    });
  });
});

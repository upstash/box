import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exposeCommand, exposeDeleteCommand, exposeListCommand } from "../../commands/expose.js";
import { CliError } from "../../core/errors.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

describe("box expose", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.UPSTASH_BOX_API_KEY = "box_test";
    getBox.mockReset();
  });
  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  const out = () => stdout.mock.calls.map((call) => String(call[0])).join("");
  const err = () => stderr.mock.calls.map((call) => String(call[0])).join("");
  const flags = { box: "b1", token: "box_test" };

  it("prints the URL and how to keep the server alive", async () => {
    const getPublicURL = vi.fn().mockResolvedValue({ url: "https://b1-3000.example", port: 3000 });
    getBox.mockResolvedValue({ getPublicURL });
    await exposeCommand("3000", { ...flags });
    expect(getPublicURL).toHaveBeenCalledWith(3000, {});
    expect(out()).toContain("https://b1-3000.example");
    // The detach hint is advice, not output, so it must not reach a pipe.
    expect(err()).toContain("detached");
    expect(out()).not.toContain("detached");
  });

  it("passes the auth options through only when asked", async () => {
    const getPublicURL = vi.fn().mockResolvedValue({
      url: "https://b1-3000.example",
      username: "u",
      password: "p",
    });
    getBox.mockResolvedValue({ getPublicURL });
    await exposeCommand("3000", { ...flags, basicAuth: true });
    expect(getPublicURL).toHaveBeenCalledWith(3000, { basicAuth: true });
    // Credentials are shown once and cannot be read back later.
    expect(out()).toContain("user: u  password: p");
  });

  it("rejects a port outside the valid range rather than calling the API", async () => {
    const getPublicURL = vi.fn();
    getBox.mockResolvedValue({ getPublicURL });
    await expect(exposeCommand("99999", { ...flags })).rejects.toThrow(CliError);
    await expect(exposeCommand("http", { ...flags })).rejects.toThrow(CliError);
    expect(getPublicURL).not.toHaveBeenCalled();
  });

  it("lists exposed ports", async () => {
    getBox.mockResolvedValue({
      listPublicURLs: vi.fn().mockResolvedValue({
        publicURLs: [{ port: 3000, url: "https://b1-3000.example" }],
      }),
    });
    await exposeListCommand({ ...flags });
    expect(out()).toContain("3000  https://b1-3000.example");
  });

  it("says so on stderr when nothing is exposed, leaving stdout empty", async () => {
    getBox.mockResolvedValue({ listPublicURLs: vi.fn().mockResolvedValue({ publicURLs: [] }) });
    await exposeListCommand({ ...flags });
    expect(err()).toContain("No exposed ports.");
    expect(out()).toBe("");
  });

  it("emits an empty array under --json rather than a message", async () => {
    getBox.mockResolvedValue({ listPublicURLs: vi.fn().mockResolvedValue({ publicURLs: [] }) });
    await exposeListCommand({ ...flags, json: true });
    expect(JSON.parse(out())).toEqual([]);
    expect(err()).not.toContain("No exposed ports.");
  });

  it("deletes by port", async () => {
    const deletePublicURL = vi.fn().mockResolvedValue(undefined);
    getBox.mockResolvedValue({ deletePublicURL });
    await exposeDeleteCommand("3000", { ...flags });
    expect(deletePublicURL).toHaveBeenCalledWith(3000);
  });
});

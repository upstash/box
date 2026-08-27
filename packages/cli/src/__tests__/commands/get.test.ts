import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatCreated, getCommand } from "../../commands/get.js";
import { CliError } from "../../core/errors.js";

vi.mock("@upstash/box", () => ({
  Box: {
    get: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

import { Box } from "@upstash/box";

const RECORD = {
  id: "box-1",
  name: "my-box",
  status: "running",
  runtime: "node",
  size: "small",
  labels: ["beta"],
  created_at: 1_787_756_493,
  updated_at: 1_787_756_493,
};

describe("box get", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => vi.restoreAllMocks());

  const out = () => stdout.mock.calls.map((call) => String(call[0])).join("");

  function listing(records: unknown[], status = "running") {
    vi.mocked(Box.list).mockResolvedValue(records as never);
    vi.mocked(Box.get).mockResolvedValue({
      getStatus: vi.fn().mockResolvedValue({ status }),
    } as never);
  }

  it("prints the fields a reader wants, not just the id", async () => {
    listing([RECORD]);
    await getCommand("box-1", { token: "key" });
    const text = out();
    expect(text).toContain("box-1");
    expect(text).toContain("name: my-box");
    expect(text).toContain("runtime: node");
    expect(text).toContain("labels: beta");
  });

  it("prefers the live status over the one in the listing", async () => {
    // A box pauses on its own, so the listing can be stale by the time it is read.
    listing([{ ...RECORD, status: "running" }], "paused");
    await getCommand("box-1", { token: "key" });
    expect(out()).toContain("status: paused");
    expect(out()).not.toContain("status: running");
  });

  it("still prints the listing when the status call fails", async () => {
    vi.mocked(Box.list).mockResolvedValue([RECORD] as never);
    vi.mocked(Box.get).mockRejectedValue(new Error("network"));
    await getCommand("box-1", { token: "key" });
    expect(out()).toContain("status: running");
  });

  it("emits the whole record under --json", async () => {
    listing([RECORD]);
    await getCommand("box-1", { token: "key", json: true });
    expect(JSON.parse(out())).toMatchObject({ id: "box-1", name: "my-box", runtime: "node" });
  });

  it("names the box that was not found rather than printing an empty record", async () => {
    listing([RECORD]);
    await expect(getCommand("box-2", { token: "key" })).rejects.toThrow(CliError);
  });

  it("omits fields the API left empty", async () => {
    listing([{ id: "box-1", status: "running", created_at: 0, updated_at: 0, model: "" }]);
    const text = () => out();
    await getCommand("box-1", { token: "key" });
    expect(text()).not.toContain("model:");
    expect(text()).not.toContain("name:");
    expect(text()).not.toContain("created:");
  });
});

describe("formatCreated", () => {
  it("reads the API's epoch seconds as seconds", () => {
    // Read as milliseconds this lands in 1970, which is the failure worth pinning.
    expect(formatCreated(1_787_756_493)).toBe("2026-08-26T15:01:33.000Z");
  });

  it("passes milliseconds through unchanged", () => {
    expect(formatCreated(1_787_756_493_000)).toBe("2026-08-26T15:01:33.000Z");
  });

  it("shows nothing for a missing or zero timestamp", () => {
    expect(formatCreated(undefined)).toBeUndefined();
    expect(formatCreated(0)).toBeUndefined();
  });
});

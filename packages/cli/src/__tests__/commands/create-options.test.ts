import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommand } from "../../commands/create.js";
import { CliError } from "../../core/errors.js";

vi.mock("@upstash/box", () => ({ Box: { create: vi.fn() } }));
vi.mock("../../repl/terminal.js", () => ({ startRepl: vi.fn() }));
vi.mock("../../auth.js", () => ({ resolveToken: vi.fn((t?: string) => t ?? "resolved-token") }));
vi.mock("../../commands/create-wizard.js", () => ({ createWizard: vi.fn() }));
const writeBoxFile = vi.hoisted(() => vi.fn(() => "/tmp/.box"));
vi.mock("../../core/box-ref.js", () => ({ writeBoxFile }));

import { Box } from "@upstash/box";

describe("create options that only exist at create time", () => {
  let dir: string;
  const base = { token: "box_test", repl: false, use: false };
  const sent = () => vi.mocked(Box.create).mock.calls[0]![0] as Record<string, unknown>;

  const fileAt = (body: unknown) => {
    const path = join(dir, "opts.json");
    writeFileSync(path, JSON.stringify(body));
    return path;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Box.create).mockResolvedValue({ id: "box-1" } as never);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    dir = mkdtempSync(join(tmpdir(), "box-create-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("--skill", () => {
    it("sends the skills as a list", async () => {
      await createCommand({ ...base, skill: ["upstash/skills/redis", "upstash/skills/qstash"] });

      expect(sent().skills).toEqual(["upstash/skills/redis", "upstash/skills/qstash"]);
    });

    it("omits the field entirely when no skill is named", async () => {
      // An empty array would read as "enable nothing" rather than "unspecified".
      await createCommand({ ...base, skill: [] });

      expect(sent()).not.toHaveProperty("skills");
    });
  });

  describe("--attach-header", () => {
    it("keys headers by host pattern", async () => {
      await createCommand({
        ...base,
        attachHeader: ["api.stripe.com:Authorization=Bearer sk_live_x"],
      });

      expect(sent().attachHeaders).toEqual({
        "api.stripe.com": { Authorization: "Bearer sk_live_x" },
      });
    });

    it("keeps a wildcard host whole, since the pattern carries no colon", async () => {
      await createCommand({ ...base, attachHeader: ["*.example.com:X-Token=abc"] });

      expect(sent().attachHeaders).toEqual({ "*.example.com": { "X-Token": "abc" } });
    });

    it("collects several headers for one host rather than replacing", async () => {
      await createCommand({
        ...base,
        attachHeader: ["api.test:A=1", "api.test:B=2"],
      });

      expect(sent().attachHeaders).toEqual({ "api.test": { A: "1", B: "2" } });
    });

    it("keeps a value containing = intact", async () => {
      // Splitting on the last = would truncate a base64 token.
      await createCommand({ ...base, attachHeader: ["api.test:X=a=b=="] });

      expect(sent().attachHeaders).toEqual({ "api.test": { X: "a=b==" } });
    });

    it("rejects an entry with no header assignment", async () => {
      await expect(createCommand({ ...base, attachHeader: ["api.test"] })).rejects.toThrow(
        /host:Name=value/,
      );
    });

    it("rejects an empty header name", async () => {
      await expect(createCommand({ ...base, attachHeader: ["api.test:=v"] })).rejects.toThrow(
        CliError,
      );
    });

    it("reads a headers file, and lets an inline flag win for the same host", async () => {
      const path = fileAt({ "api.test": { A: "from-file" } });

      await createCommand({
        ...base,
        attachHeadersFile: path,
        attachHeader: ["api.test:A=inline"],
      });

      expect(sent().attachHeaders).toEqual({ "api.test": { A: "inline" } });
    });

    it("names the file when it cannot be read", async () => {
      await expect(
        createCommand({ ...base, attachHeadersFile: join(dir, "missing.json") }),
      ).rejects.toThrow(/Could not read --attach-headers-file/);
    });

    it("refuses a headers file that is an array, not an object", async () => {
      await expect(createCommand({ ...base, attachHeadersFile: fileAt([]) })).rejects.toThrow(
        /keyed by host pattern/,
      );
    });

    it("refuses a non-string header value rather than sending it", async () => {
      await expect(
        createCommand({ ...base, attachHeadersFile: fileAt({ "api.test": { A: 1 } }) }),
      ).rejects.toThrow(/must be a string/);
    });
  });

  describe("--mcp", () => {
    it("treats an https spec as a remote server", async () => {
      await createCommand({ ...base, mcp: ["docs=https://mcp.example.com/sse"] });

      expect(sent().mcpServers).toEqual([{ name: "docs", url: "https://mcp.example.com/sse" }]);
    });

    it("treats anything else as an npm package", async () => {
      await createCommand({ ...base, mcp: ["fs=@modelcontextprotocol/server-filesystem"] });

      expect(sent().mcpServers).toEqual([
        { name: "fs", package: "@modelcontextprotocol/server-filesystem" },
      ]);
    });

    it("splits on the first =, so a scoped package keeps its name", async () => {
      await createCommand({ ...base, mcp: ["a=b=c"] });

      expect(sent().mcpServers).toEqual([{ name: "a", package: "b=c" }]);
    });

    it("rejects an entry with no name", async () => {
      await expect(createCommand({ ...base, mcp: ["=pkg"] })).rejects.toThrow(/Invalid --mcp/);
    });

    it("rejects an entry with nothing after the =", async () => {
      await expect(createCommand({ ...base, mcp: ["name="] })).rejects.toThrow(/nothing after/);
    });

    it("reads a file for servers needing args or headers", async () => {
      const path = fileAt([{ name: "fs", package: "@org/server", args: ["--root", "/tmp"] }]);

      await createCommand({ ...base, mcpFile: path });

      expect(sent().mcpServers).toEqual([
        { name: "fs", package: "@org/server", args: ["--root", "/tmp"] },
      ]);
    });

    it("refuses a server that is both remote and a package", async () => {
      const path = fileAt([{ name: "x", url: "https://a.test", package: "@org/b" }]);

      await expect(createCommand({ ...base, mcpFile: path })).rejects.toThrow(/exactly one/);
    });

    it("refuses a server that is neither", async () => {
      await expect(createCommand({ ...base, mcpFile: fileAt([{ name: "x" }]) })).rejects.toThrow(
        /exactly one/,
      );
    });

    it("refuses a file that is not an array", async () => {
      await expect(createCommand({ ...base, mcpFile: fileAt({ name: "x" }) })).rejects.toThrow(
        /JSON array/,
      );
    });

    it("reports invalid JSON as such, rather than as a shape problem", async () => {
      const path = join(dir, "bad.json");
      writeFileSync(path, "{not json");

      await expect(createCommand({ ...base, mcpFile: path })).rejects.toThrow(/not valid JSON/);
    });
  });

  describe("--network-policy", () => {
    it("sends a blanket mode with no lists", async () => {
      await createCommand({ ...base, networkPolicy: "deny-all" });

      expect(sent().networkPolicy).toEqual({ mode: "deny-all" });
    });

    it("builds a custom policy from the lists", async () => {
      await createCommand({
        ...base,
        networkPolicy: "custom",
        allowDomain: ["api.example.com"],
        denyCidr: ["10.0.0.0/8"],
      });

      expect(sent().networkPolicy).toEqual({
        mode: "custom",
        allowedDomains: ["api.example.com"],
        deniedCidrs: ["10.0.0.0/8"],
      });
    });

    it("refuses lists on a blanket mode, which would look like they applied", async () => {
      await expect(
        createCommand({ ...base, networkPolicy: "allow-all", allowDomain: ["a.test"] }),
      ).rejects.toThrow(/only apply to 'custom'/);
    });

    it("refuses lists with no --network-policy at all", async () => {
      // Silently dropping them would create a box with unrestricted egress
      // while the command line says otherwise.
      await expect(createCommand({ ...base, allowDomain: ["a.test"] })).rejects.toThrow(
        /need --network-policy custom/,
      );
    });

    it("refuses custom with no lists, which would be an empty policy", async () => {
      await expect(createCommand({ ...base, networkPolicy: "custom" })).rejects.toThrow(
        /at least one/,
      );
    });

    it("rejects an unknown mode", async () => {
      await expect(createCommand({ ...base, networkPolicy: "everything" })).rejects.toThrow(
        /mode must be/,
      );
    });

    it("does not send a policy when the flag is absent", async () => {
      await createCommand({ ...base });

      expect(sent()).not.toHaveProperty("networkPolicy");
    });
  });
});

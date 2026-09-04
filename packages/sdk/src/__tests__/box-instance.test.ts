import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox, TEST_CONFIG } from "./helpers.js";

describe("Box instance methods", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("exec.command", () => {
    it("executes a command and returns completed run", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ exit_code: 0, output: "hello world" }));

      const run = await box.exec.command("echo hello world");
      expect(run.result).toBe("hello world");
      expect(run.status).toBe("completed");
      expect(run.type).toBe("command");
      expect(run.exitCode).toBe(0);

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/exec");
      const body = JSON.parse(init?.body as string);
      expect(body.command).toEqual(["sh", "-c", "echo hello world"]);
    });

    it("marks run as failed on non-zero exit code", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ exit_code: 1, output: "error message" }));

      const run = await box.exec.command("false");
      expect(run.status).toBe("failed");
      expect(run.exitCode).toBe(1);
      expect(run.result).toBe("error message");
    });

    it("keeps stdout as result when a successful command also writes to stderr", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ exit_code: 0, output: "out line\n", error: "warning line\n" }),
      );

      const run = await box.exec.command("echo 'out line'; echo 'warning line' >&2");
      expect(run.result).toBe("out line\n");
      expect(run.stdout).toBe("out line\n");
      expect(run.stderr).toBe("warning line\n");
      expect(run.status).toBe("completed");
    });

    it("prefers stderr as result on failure but exposes both streams", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ exit_code: 1, output: "partial out\n", error: "boom\n" }),
      );

      const run = await box.exec.command("exit 1");
      expect(run.result).toBe("boom\n");
      expect(run.stdout).toBe("partial out\n");
      expect(run.stderr).toBe("boom\n");
      expect(run.status).toBe("failed");
    });
  });

  describe("exec.code", () => {
    it("executes JavaScript code and returns run", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ output: '{"sum":3}', exit_code: 0 }));

      const run = await box.exec.code({
        code: "console.log(JSON.stringify({ sum: 1 + 2 }))",
        lang: "js",
      });

      expect(run.result).toBe('{"sum":3}');
      expect(run.exitCode).toBe(0);
      expect(run.type).toBe("code");
      expect(run.status).toBe("completed");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/code");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.code).toContain("sum");
      expect(body.language).toBe("js");
    });

    it("executes TypeScript code", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ output: "Oldest user: Alice (age 30)", exit_code: 0 }),
      );

      const run = await box.exec.code({
        code: "const x: number = 42; console.log(x)",
        lang: "ts",
      });

      expect(run.result).toBe("Oldest user: Alice (age 30)");
      expect(run.exitCode).toBe(0);
    });

    it("executes Python code", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ output: '{"sum": 15}', exit_code: 0 }));

      const run = await box.exec.code({
        code: 'import json; print(json.dumps({"sum": 15}))',
        lang: "python",
      });

      expect(run.result).toBe('{"sum": 15}');
      expect(run.exitCode).toBe(0);
    });

    it("returns error on failed execution", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          output: "",
          exit_code: 1,
          error: "Error: something went wrong\n    at Object.<anonymous>",
        }),
      );

      const run = await box.exec.code({
        code: 'throw new Error("something went wrong")',
        lang: "js",
      });

      expect(run.exitCode).toBe(1);
      expect(run.status).toBe("failed");
      expect(run.result).toContain("something went wrong");
    });

    it("passes timeout when provided", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ output: "ok", exit_code: 0 }));

      await box.exec.code({
        code: 'console.log("ok")',
        lang: "js",
        timeout: 5000,
      });

      const [, init] = fetchMock.mock.calls[1]!;
      const body = JSON.parse(init?.body as string);
      expect(body.timeout).toBe(5000);
    });

    it("omits timeout when not provided", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ output: "ok", exit_code: 0 }));

      await box.exec.code({
        code: 'console.log("ok")',
        lang: "js",
      });

      const [, init] = fetchMock.mock.calls[1]!;
      const body = JSON.parse(init?.body as string);
      expect(body.timeout).toBeUndefined();
    });
  });

  describe("getStatus", () => {
    it("returns box status", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: "running" }));

      const status = await box.getStatus();
      expect(status).toEqual({ status: "running" });
    });

    it.each(["creating", "idle", "running", "paused", "error", "deleted"] as const)(
      "returns %s status",
      async (expected) => {
        const { box, fetchMock } = await createTestBox();
        fetchMock.mockResolvedValueOnce(mockResponse({ status: expected }));

        const { status } = await box.getStatus();
        expect(status).toBe(expected);
      },
    );
  });

  describe("pause", () => {
    it("sends pause request", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.pause();
      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/pause");
      expect(init?.method).toBe("POST");
    });

    it("status is paused after pause", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock
        .mockResolvedValueOnce(mockResponse({})) // pause
        .mockResolvedValueOnce(mockResponse({ status: "paused" })); // getStatus

      await box.pause();
      const { status } = await box.getStatus();
      expect(status).toBe("paused");
    });

    it("throws for keep-alive boxes", async () => {
      const { box, fetchMock } = await createTestBox({ keep_alive: true });

      await expect(box.pause()).rejects.toThrow("Keep-alive boxes cannot be paused");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("resume", () => {
    it("sends resume request", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.resume();
      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/resume");
      expect(init?.method).toBe("POST");
    });

    it("status is running after resume", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock
        .mockResolvedValueOnce(mockResponse({})) // resume
        .mockResolvedValueOnce(mockResponse({ status: "running" })); // getStatus

      await box.resume();
      const { status } = await box.getStatus();
      expect(status).toBe("running");
    });
  });

  describe("pause/resume lifecycle", () => {
    it("transitions through running → paused → running", async () => {
      const { box, fetchMock } = await createTestBox(); // initial status: running
      fetchMock
        .mockResolvedValueOnce(mockResponse({ status: "running" })) // getStatus (initial)
        .mockResolvedValueOnce(mockResponse({})) // pause
        .mockResolvedValueOnce(mockResponse({ status: "paused" })) // getStatus (after pause)
        .mockResolvedValueOnce(mockResponse({})) // resume
        .mockResolvedValueOnce(mockResponse({ status: "running" })); // getStatus (after resume)

      // Verify initial status is running
      const initial = await box.getStatus();
      expect(initial.status).toBe("running");

      // Pause and verify
      await box.pause();
      const afterPause = await box.getStatus();
      expect(afterPause.status).toBe("paused");

      // Resume and verify
      await box.resume();
      const afterResume = await box.getStatus();
      expect(afterResume.status).toBe("running");
    });

    it("verifies correct endpoints are called in order", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock
        .mockResolvedValueOnce(mockResponse({})) // pause
        .mockResolvedValueOnce(mockResponse({ status: "paused" })) // getStatus
        .mockResolvedValueOnce(mockResponse({})) // resume
        .mockResolvedValueOnce(mockResponse({ status: "running" })); // getStatus

      await box.pause();
      await box.getStatus();
      await box.resume();
      await box.getStatus();

      // calls[0] is Box.get, calls[1..4] are our lifecycle calls
      expect(fetchMock.mock.calls[1]![0]).toContain("/pause");
      expect(fetchMock.mock.calls[2]![0]).toContain("/status");
      expect(fetchMock.mock.calls[3]![0]).toContain("/resume");
      expect(fetchMock.mock.calls[4]![0]).toContain("/status");
    });
  });

  describe("updateNetworkPolicy", () => {
    it("sends PUT with allow-all mode and updates local field", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.updateNetworkPolicy({ mode: "allow-all" });

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/config/network-policy");
      expect(init?.method).toBe("PUT");
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ mode: "allow-all" });
      expect(box.networkPolicy).toEqual({ mode: "allow-all" });
    });

    it("sends PUT with deny-all mode and updates local field", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.updateNetworkPolicy({ mode: "deny-all" });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body).toEqual({ mode: "deny-all" });
      expect(box.networkPolicy).toEqual({ mode: "deny-all" });
    });

    it("sends PUT with custom mode, serializes fields, and updates local field", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      const policy = {
        mode: "custom" as const,
        allowedDomains: ["api.example.com"],
        allowedCidrs: ["10.0.0.0/8"],
        deniedCidrs: ["192.168.0.0/16"],
      };
      await box.updateNetworkPolicy(policy);

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body).toEqual({
        mode: "custom",
        allowed_domains: ["api.example.com"],
        allowed_cidrs: ["10.0.0.0/8"],
        denied_cidrs: ["192.168.0.0/16"],
      });
      expect(box.networkPolicy).toEqual(policy);
    });
  });

  describe("delete", () => {
    it("sends delete request", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.delete();
      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123");
      expect(init?.method).toBe("DELETE");
    });
  });

  describe("init command", () => {
    it("reads init command for keep-alive boxes", async () => {
      const { box, fetchMock } = await createTestBox({ keep_alive: true });
      fetchMock.mockResolvedValueOnce(mockResponse({ init_command: "npm run dev" }));

      await expect(box.getInitCommand()).resolves.toBe("npm run dev");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/startup");
      expect(init?.method).toBe("GET");
    });

    it("sets init command for keep-alive boxes", async () => {
      const { box, fetchMock } = await createTestBox({ keep_alive: true });
      fetchMock.mockResolvedValueOnce(mockResponse({ message: "startup script updated" }));

      await box.setInitCommand("npm run dev");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/startup");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(init?.body as string)).toEqual({ init_command: "npm run dev" });
    });

    it("deletes init command for keep-alive boxes", async () => {
      const { box, fetchMock } = await createTestBox({ keep_alive: true });
      fetchMock.mockResolvedValueOnce(mockResponse({ message: "startup script deleted" }));

      await box.deleteInitCommand();

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/startup");
      expect(init?.method).toBe("DELETE");
    });

    it("throws when setting an empty init command", async () => {
      const { box } = await createTestBox({ keep_alive: true });
      await expect(box.setInitCommand("")).rejects.toThrow("initCommand is required");
    });

    it("throws for non-keep-alive boxes", async () => {
      const { box, fetchMock } = await createTestBox();

      await expect(box.getInitCommand()).rejects.toThrow(
        "Init command is only available for keep-alive boxes",
      );
      await expect(box.setInitCommand("echo hi")).rejects.toThrow(
        "Init command is only available for keep-alive boxes",
      );
      await expect(box.deleteInitCommand()).rejects.toThrow(
        "Init command is only available for keep-alive boxes",
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("logs", () => {
    it("fetches logs", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          logs: [{ timestamp: 1000, level: "info", source: "system", message: "booted" }],
        }),
      );

      const logs = await box.logs();
      expect(logs).toHaveLength(1);
      expect(logs[0]!.message).toBe("booted");
    });

    it("passes offset and limit", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ logs: [] }));

      await box.logs({ offset: 10, limit: 5 });
      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain("offset=10");
      expect(url).toContain("limit=5");
    });
  });

  describe("listRuns", () => {
    it("returns runs for the box", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          runs: [
            { id: "r1", box_id: "box-123", type: "agent", status: "completed" },
            { id: "r2", box_id: "box-123", type: "shell", status: "completed" },
          ],
        }),
      );

      const runs = await box.listRuns();
      expect(runs).toHaveLength(2);
      expect(runs[0]!.id).toBe("r1");
    });
  });
});

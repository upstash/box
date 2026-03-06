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
      expect(run._status).toBe("completed");
      expect(run.type).toBe("shell");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/exec");
      const body = JSON.parse(init?.body as string);
      expect(body.command).toEqual(["sh", "-c", "echo hello world"]);
    });

    it("marks run as failed on non-zero exit code", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ exit_code: 1, output: "error message" }));

      const run = await box.exec.command("false");
      expect(run._status).toBe("failed");
      expect(run.result).toBe("error message");
    });
  });

  describe("exec.code", () => {
    it("executes JavaScript code and returns result", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ output: '{"sum":3}', exit_code: 0 }));

      const result = await box.exec.code({
        code: "console.log(JSON.stringify({ sum: 1 + 2 }))",
        lang: "js",
      });

      expect(result.output).toBe('{"sum":3}');
      expect(result.exit_code).toBe(0);

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

      const result = await box.exec.code({
        code: "const x: number = 42; console.log(x)",
        lang: "ts",
      });

      expect(result.output).toBe("Oldest user: Alice (age 30)");
      expect(result.exit_code).toBe(0);
    });

    it("executes Python code", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ output: '{"sum": 15}', exit_code: 0 }));

      const result = await box.exec.code({
        code: 'import json; print(json.dumps({"sum": 15}))',
        lang: "python",
      });

      expect(result.output).toBe('{"sum": 15}');
      expect(result.exit_code).toBe(0);
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

      const result = await box.exec.code({
        code: 'throw new Error("something went wrong")',
        lang: "js",
      });

      expect(result.exit_code).toBe(1);
      expect(result.error).toContain("something went wrong");
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

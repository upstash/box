import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox, TEST_CONFIG } from "./helpers.js";

describe("Box instance methods", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("exec", () => {
    it("executes a command and returns completed run", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ exit_code: 0, output: "hello world" }));

      const run = await box.exec("echo hello world");
      expect(await run.result()).toBe("hello world");
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

      const run = await box.exec("false");
      expect(run._status).toBe("failed");
      expect(await run.result()).toBe("error message");
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

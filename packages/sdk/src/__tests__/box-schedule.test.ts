import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox } from "./helpers.js";
import { Agent } from "../types.js";

describe("Box schedule operations", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("schedule.exec", () => {
    it("creates an exec schedule", async () => {
      const { box, fetchMock } = await createTestBox();
      const schedule = {
        id: "sched-1",
        box_id: "box-123",
        type: "exec",
        cron: "* * * * *",
        command: ["bash", "-c", "echo hello"],
        status: "active",
        total_runs: 0,
        total_failures: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      };
      fetchMock.mockResolvedValueOnce(mockResponse(schedule));

      const result = await box.schedule.exec({
        cron: "* * * * *",
        command: ["bash", "-c", "echo hello"],
      });

      expect(result.id).toBe("sched-1");
      expect(result.type).toBe("exec");
      expect(result.status).toBe("active");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/schedules");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.type).toBe("exec");
      expect(body.command).toEqual(["bash", "-c", "echo hello"]);
      expect(body.cron).toBe("* * * * *");
      expect(body.folder).toBe("/workspace/home");
    });

    it("sends optional fields when provided", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          id: "sched-1",
          box_id: "box-123",
          type: "exec",
          cron: "* * * * *",
          command: ["npm", "test"],
          status: "active",
          folder: "/workspace/project",
          webhook_url: "https://example.com/hook",
          total_runs: 0,
          total_failures: 0,
          created_at: 1710000000,
          updated_at: 1710000000,
        }),
      );

      await box.schedule.exec({
        cron: "* * * * *",
        command: ["npm", "test"],
        folder: "/workspace/project",
        webhookUrl: "https://example.com/hook",
        webhookHeaders: { Authorization: "Bearer tok" },
      });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.folder).toBe("/workspace/project");
      expect(body.webhook_url).toBe("https://example.com/hook");
      expect(body.webhook_headers).toEqual({ Authorization: "Bearer tok" });
    });
  });

  describe("schedule.agent", () => {
    it("creates a prompt schedule", async () => {
      const { box, fetchMock } = await createTestBox();
      const schedule = {
        id: "sched-2",
        box_id: "box-123",
        type: "prompt",
        cron: "0 9 * * *",
        prompt: "Run tests",
        status: "active",
        total_runs: 0,
        total_failures: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      };
      fetchMock.mockResolvedValueOnce(mockResponse(schedule));

      const result = await box.schedule.agent({
        cron: "0 9 * * *",
        prompt: "Run tests",
      });

      expect(result.id).toBe("sched-2");
      expect(result.type).toBe("prompt");

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.type).toBe("prompt");
      expect(body.prompt).toBe("Run tests");
      expect(body.cron).toBe("0 9 * * *");
      expect(body.folder).toBe("/workspace/home");
    });

    it("sends model and webhook fields when provided", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          id: "sched-2",
          box_id: "box-123",
          type: "prompt",
          cron: "0 9 * * *",
          prompt: "Run tests",
          status: "active",
          total_runs: 0,
          total_failures: 0,
          created_at: 1710000000,
          updated_at: 1710000000,
        }),
      );

      await box.schedule.agent({
        cron: "0 9 * * *",
        prompt: "Run tests",
        model: "claude/sonnet_4_6",
        folder: "/workspace/app",
        webhookUrl: "https://example.com/hook",
        webhookHeaders: { "x-key": "val" },
      });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.model).toBe("claude/sonnet_4_6");
      expect(body.folder).toBe("/workspace/app");
      expect(body.webhook_url).toBe("https://example.com/hook");
      expect(body.webhook_headers).toEqual({ "x-key": "val" });
    });

    it("sends timeout when provided", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          id: "sched-2",
          box_id: "box-123",
          type: "prompt",
          cron: "0 9 * * *",
          prompt: "Run tests",
          status: "active",
          timeout: 300000,
          total_runs: 0,
          total_failures: 0,
          created_at: 1710000000,
          updated_at: 1710000000,
        }),
      );

      await box.schedule.agent({
        cron: "0 9 * * *",
        prompt: "Run tests",
        timeout: 300000,
      });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.timeout).toBe(300000);
    });

    it("sends agent_options when provided", async () => {
      const { box, fetchMock } = await createTestBox<Agent.ClaudeCode>();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          id: "sched-2",
          box_id: "box-123",
          type: "prompt",
          cron: "0 9 * * *",
          prompt: "Run tests",
          status: "active",
          total_runs: 0,
          total_failures: 0,
          created_at: 1710000000,
          updated_at: 1710000000,
        }),
      );

      await box.schedule.agent({
        cron: "0 9 * * *",
        prompt: "Run tests",
        options: {
          maxTurns: 5,
          maxBudgetUsd: 1.0,
          effort: "high",
          systemPrompt: "You are a test runner",
        },
      });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.agent_options).toEqual({
        maxTurns: 5,
        maxBudgetUsd: 1.0,
        effort: "high",
        systemPrompt: "You are a test runner",
      });
    });

    it("does not send timeout or agent_options when omitted", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          id: "sched-2",
          box_id: "box-123",
          type: "prompt",
          cron: "0 9 * * *",
          prompt: "Run tests",
          status: "active",
          total_runs: 0,
          total_failures: 0,
          created_at: 1710000000,
          updated_at: 1710000000,
        }),
      );

      await box.schedule.agent({
        cron: "0 9 * * *",
        prompt: "Run tests",
      });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.timeout).toBeUndefined();
      expect(body.agent_options).toBeUndefined();
    });
  });

  describe("schedule.list", () => {
    it("returns all schedules", async () => {
      const { box, fetchMock } = await createTestBox();
      const schedules = [
        {
          id: "sched-1",
          box_id: "box-123",
          type: "exec",
          cron: "* * * * *",
          status: "active",
          total_runs: 5,
          total_failures: 0,
          created_at: 1710000000,
          updated_at: 1710000000,
        },
        {
          id: "sched-2",
          box_id: "box-123",
          type: "prompt",
          cron: "0 9 * * *",
          status: "paused",
          total_runs: 3,
          total_failures: 1,
          created_at: 1710000000,
          updated_at: 1710000000,
        },
      ];
      fetchMock.mockResolvedValueOnce(mockResponse(schedules));

      const result = await box.schedule.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("sched-1");
      expect(result[1]!.id).toBe("sched-2");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/schedules");
      expect(init?.method).toBe("GET");
    });
  });

  describe("schedule.get", () => {
    it("returns a specific schedule", async () => {
      const { box, fetchMock } = await createTestBox();
      const schedule = {
        id: "sched-1",
        box_id: "box-123",
        type: "exec",
        cron: "* * * * *",
        command: ["echo", "hi"],
        status: "active",
        total_runs: 0,
        total_failures: 0,
        created_at: 1710000000,
        updated_at: 1710000000,
      };
      fetchMock.mockResolvedValueOnce(mockResponse(schedule));

      const result = await box.schedule.get("sched-1");

      expect(result.id).toBe("sched-1");

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/schedules/sched-1");
    });
  });

  describe("schedule.pause", () => {
    it("pauses a schedule", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ message: "Schedule paused" }));

      await box.schedule.pause("sched-1");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/schedules/sched-1/pause");
      expect(init?.method).toBe("POST");
    });
  });

  describe("schedule.resume", () => {
    it("resumes a schedule", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ message: "Schedule resumed" }));

      await box.schedule.resume("sched-1");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/schedules/sched-1/resume");
      expect(init?.method).toBe("POST");
    });
  });

  describe("schedule.delete", () => {
    it("deletes a schedule", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse(undefined));

      await box.schedule.delete("sched-1");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/schedules/sched-1");
      expect(init?.method).toBe("DELETE");
    });
  });

  describe("folder resolution", () => {
    it("resolves relative folder against cwd", async () => {
      const { box, fetchMock } = await createTestBox();
      // Simulate cd by creating a directory and cd-ing
      fetchMock
        .mockResolvedValueOnce(mockResponse({ exit_code: 0, output: "" })) // ls for cd
        .mockResolvedValueOnce(
          mockResponse({
            id: "sched-1",
            box_id: "box-123",
            type: "exec",
            cron: "* * * * *",
            command: ["echo"],
            status: "active",
            total_runs: 0,
            total_failures: 0,
            created_at: 1710000000,
            updated_at: 1710000000,
          }),
        );

      await box.cd("/workspace/home/project");

      await box.schedule.exec({
        cron: "* * * * *",
        command: ["echo"],
        folder: "src",
      });

      // calls[0] = Box.get, calls[1] = cd ls, calls[2] = schedule create
      const body = JSON.parse(fetchMock.mock.calls[2]![1]?.body as string);
      expect(body.folder).toBe("/workspace/home/project/src");
    });

    it("uses absolute folder as-is", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          id: "sched-1",
          box_id: "box-123",
          type: "prompt",
          cron: "* * * * *",
          prompt: "test",
          status: "active",
          total_runs: 0,
          total_failures: 0,
          created_at: 1710000000,
          updated_at: 1710000000,
        }),
      );

      await box.schedule.agent({
        cron: "* * * * *",
        prompt: "test",
        folder: "/opt/custom",
      });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.folder).toBe("/opt/custom");
    });
  });
});

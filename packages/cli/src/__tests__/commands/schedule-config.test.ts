import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleExecCommand,
  scheduleAgentCommand,
  scheduleListCommand,
  scheduleUpdateCommand,
  schedulePauseCommand,
  scheduleDeleteCommand,
} from "../../commands/schedule.js";
import {
  configureModelCommand,
  networkPolicyCommand,
  skillsAddCommand,
  skillsListCommand,
  initCommandSetCommand,
} from "../../commands/config.js";
import { CliError } from "../../core/errors.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

vi.mock("../../core/box-ref.js", () => ({
  resolveBoxId: vi.fn(() => ({ id: "b1", source: "flag" })),
  announceBox: vi.fn(),
}));

describe("schedule and config", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  const flags = { box: "b1", token: "box_test" };
  const written = () => stdout.mock.calls.map((c) => String(c[0])).join("");

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    getBox.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  describe("schedule exec", () => {
    it("sends the command as argv, so quoting survives", async () => {
      const exec = vi.fn().mockResolvedValue({ id: "sch-1" });
      getBox.mockResolvedValue({ schedule: { exec } });

      await scheduleExecCommand(["npm", "run", "backup"], { ...flags, cron: "0 9 * * *" });

      expect(exec).toHaveBeenCalledWith({ cron: "0 9 * * *", command: ["npm", "run", "backup"] });
      expect(written()).toContain("sch-1");
    });

    it("refuses without a cron, rather than creating something that never runs", async () => {
      getBox.mockResolvedValue({ schedule: { exec: vi.fn() } });

      await expect(scheduleExecCommand(["ls"], { ...flags })).rejects.toThrow(/--cron/);
    });

    it("refuses an empty command", async () => {
      getBox.mockResolvedValue({ schedule: { exec: vi.fn() } });

      await expect(scheduleExecCommand([], { ...flags, cron: "0 9 * * *" })).rejects.toThrow(
        CliError,
      );
    });
  });

  describe("schedule agent", () => {
    it("joins the prompt words", async () => {
      const agent = vi.fn().mockResolvedValue({ id: "sch-2" });
      getBox.mockResolvedValue({ schedule: { agent } });

      await scheduleAgentCommand(["check", "the", "logs"], { ...flags, cron: "@daily" });

      expect(agent).toHaveBeenCalledWith({ cron: "@daily", prompt: "check the logs" });
    });

    it("converts the timeout from seconds to the milliseconds the SDK takes", async () => {
      // Every --timeout flag is documented in seconds and every SDK option is
      // milliseconds. Passing the number straight through would ask for 60ms.
      const agent = vi.fn().mockResolvedValue({ id: "sch-2" });
      getBox.mockResolvedValue({ schedule: { agent } });

      await scheduleAgentCommand(["x"], { ...flags, cron: "@daily", timeout: "60" });

      expect(agent).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60_000 }));
    });

    it("forwards a webhook, which agent schedules support too", async () => {
      const agent = vi.fn().mockResolvedValue({ id: "sch-2" });
      getBox.mockResolvedValue({ schedule: { agent } });

      await scheduleAgentCommand(["x"], {
        ...flags,
        cron: "@daily",
        webhookUrl: "https://hook.test",
      });

      expect(agent).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: "https://hook.test" }),
      );
    });

    it("rejects a timeout that is not a positive number", async () => {
      getBox.mockResolvedValue({ schedule: { agent: vi.fn() } });

      await expect(
        scheduleAgentCommand(["x"], { ...flags, cron: "@daily", timeout: "0" }),
      ).rejects.toThrow(/--timeout/);
    });
  });

  it("lists schedules id-first", async () => {
    getBox.mockResolvedValue({
      schedule: {
        list: vi
          .fn()
          .mockResolvedValue([
            { id: "sch-1", type: "exec", cron: "0 9 * * *", status: "active", command: ["ls"] },
          ]),
      },
    });

    await scheduleListCommand({ ...flags });

    expect(written()).toContain("sch-1");
    expect(written()).toContain("0 9 * * *");
  });

  describe("schedule update", () => {
    it("sends only what changed, leaving the rest alone", async () => {
      const update = vi
        .fn()
        .mockResolvedValue({ id: "sch-1", type: "exec", cron: "@hourly", status: "active" });
      getBox.mockResolvedValue({ schedule: { update } });

      await scheduleUpdateCommand("sch-1", [], { ...flags, cron: "@hourly" });

      // A partial update that also sent command/prompt would clear them.
      expect(update).toHaveBeenCalledWith("sch-1", { cron: "@hourly" });
    });

    it("refuses an update that changes nothing", async () => {
      getBox.mockResolvedValue({ schedule: { update: vi.fn() } });

      await expect(scheduleUpdateCommand("sch-1", [], { ...flags })).rejects.toThrow(
        /Nothing to update/,
      );
    });
  });

  it("pauses and deletes by id", async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockResolvedValue(undefined);
    getBox.mockResolvedValue({ schedule: { pause, delete: del } });

    await schedulePauseCommand("sch-1", { ...flags });
    await scheduleDeleteCommand("sch-2", { ...flags });

    expect(pause).toHaveBeenCalledWith("sch-1");
    expect(del).toHaveBeenCalledWith("sch-2");
  });

  describe("network policy", () => {
    it("sends a blanket mode with no lists", async () => {
      const updateNetworkPolicy = vi.fn().mockResolvedValue(undefined);
      getBox.mockResolvedValue({ updateNetworkPolicy });

      await networkPolicyCommand("deny-all", { ...flags });

      expect(updateNetworkPolicy).toHaveBeenCalledWith({ mode: "deny-all" });
    });

    it("refuses lists on a blanket mode, which would look like they applied", async () => {
      getBox.mockResolvedValue({ updateNetworkPolicy: vi.fn() });

      await expect(
        networkPolicyCommand("allow-all", { ...flags, allowDomain: ["example.com"] }),
      ).rejects.toThrow(/only apply to 'custom'/);
    });

    it("refuses custom with no lists, which would be an empty policy", async () => {
      getBox.mockResolvedValue({ updateNetworkPolicy: vi.fn() });

      await expect(networkPolicyCommand("custom", { ...flags })).rejects.toThrow(/at least one/);
    });

    it("builds a custom policy from the lists given", async () => {
      const updateNetworkPolicy = vi.fn().mockResolvedValue(undefined);
      getBox.mockResolvedValue({ updateNetworkPolicy });

      await networkPolicyCommand("custom", {
        ...flags,
        allowDomain: ["api.example.com"],
        denyCidr: ["10.0.0.0/8"],
      });

      expect(updateNetworkPolicy).toHaveBeenCalledWith({
        mode: "custom",
        allowedDomains: ["api.example.com"],
        deniedCidrs: ["10.0.0.0/8"],
      });
    });

    it("rejects an unknown mode", async () => {
      getBox.mockResolvedValue({ updateNetworkPolicy: vi.fn() });

      await expect(networkPolicyCommand("everything", { ...flags })).rejects.toThrow(
        /mode must be/,
      );
    });
  });

  it("configures the model", async () => {
    const configureModel = vi.fn().mockResolvedValue(undefined);
    getBox.mockResolvedValue({ configureModel });

    await configureModelCommand("anthropic/claude-sonnet-5", { ...flags });

    expect(configureModel).toHaveBeenCalledWith("anthropic/claude-sonnet-5");
  });

  it("adds and lists skills", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    getBox.mockResolvedValue({
      skills: { add, list: vi.fn().mockResolvedValue(["upstash-redis"]) },
    });

    await skillsAddCommand("upstash-redis", { ...flags });
    await skillsListCommand({ ...flags });

    expect(add).toHaveBeenCalledWith("upstash-redis");
    expect(written()).toContain("upstash-redis");
  });

  it("refuses an empty init command", async () => {
    getBox.mockResolvedValue({ setInitCommand: vi.fn() });

    await expect(initCommandSetCommand("   ", { ...flags })).rejects.toThrow(/empty/);
  });
});

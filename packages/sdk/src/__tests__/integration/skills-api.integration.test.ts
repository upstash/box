import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent, Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("skills API", () => {
  let box: Box;
  const skillId = "upstash/qstash-js/qstash-js";

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_6 },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("add, list, then remove a skill", async () => {
    // List — should not contain the skill
    const before = await box.skills.list();
    expect(before).not.toContain(skillId);

    // Add
    await box.skills.add(skillId);

    // List — should contain the skill
    const after = await box.skills.list();
    expect(after).toContain(skillId);

    // Remove
    await box.skills.remove(skillId);

    // List — should no longer contain the skill
    const afterRemove = await box.skills.list();
    expect(afterRemove).not.toContain(skillId);
  }, 60000);

  it("list returns empty when no skills are enabled", async () => {
    const skills = await box.skills.list();
    expect(Array.isArray(skills)).toBe(true);
  });
});

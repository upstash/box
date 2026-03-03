import { describe, it, expect } from "vitest";
import { handleAgent } from "../../../repl/commands/agent.js";
import { collectEvents } from "../helpers.js";

describe("handleAgent", () => {
  it("yields switched to agent mode message", async () => {
    const events = await collectEvents(handleAgent({} as any, ""));
    expect(events).toContainEqual({ type: "log", message: "Switched to agent mode" });
  });
});

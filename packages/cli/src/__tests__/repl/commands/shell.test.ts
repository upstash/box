import { describe, it, expect } from "vitest";
import { handleShell } from "../../../repl/commands/shell.js";
import { collectEvents } from "../helpers.js";

describe("handleShell", () => {
  it("yields switched to shell mode message", async () => {
    const events = await collectEvents(handleShell({} as any, ""));
    expect(events).toContainEqual({ type: "log", message: "Switched to shell mode" });
  });
});

import { describe, it, expect, vi } from "vitest";
import { handlePause } from "../../../repl/commands/pause.js";
import { collectEvents } from "../helpers.js";

describe("handlePause", () => {
  it("pauses the box and yields exit event", async () => {
    const mockBox = {
      id: "box-1",
      pause: vi.fn().mockResolvedValue(undefined),
    };

    const events = await collectEvents(handlePause(mockBox as any, ""));

    expect(mockBox.pause).toHaveBeenCalled();
    expect(events).toContainEqual({ type: "log", message: "Box box-1 paused." });
    expect(events).toContainEqual({ type: "exit", message: "Box box-1 paused." });
  });
});

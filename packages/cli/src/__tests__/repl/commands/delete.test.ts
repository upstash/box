import { describe, it, expect, vi } from "vitest";
import { handleDelete } from "../../../repl/commands/delete.js";
import { collectEvents } from "../helpers.js";

describe("handleDelete", () => {
  it("deletes the box and yields exit event", async () => {
    const mockBox = {
      id: "box-1",
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const events = await collectEvents(handleDelete(mockBox as any, ""));

    expect(mockBox.delete).toHaveBeenCalled();
    expect(events).toContainEqual({ type: "log", message: "Box box-1 deleted." });
    expect(events).toContainEqual({ type: "exit", message: "Box box-1 deleted." });
  });
});

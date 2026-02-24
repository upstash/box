import { describe, it, expect, vi } from "vitest";
import { handlePause } from "../../../repl/commands/pause.js";
import type { REPLHooks } from "../../../repl/client.js";

function createHooks() {
  return {
    onLog: vi.fn() as unknown as REPLHooks["onLog"],
    onError: vi.fn() as unknown as REPLHooks["onError"],
    onStream: vi.fn() as unknown as REPLHooks["onStream"],
  };
}

describe("handlePause", () => {
  it("pauses the box and returns true", async () => {
    const mockBox = {
      id: "box-1",
      pause: vi.fn().mockResolvedValue(undefined),
    };
    const hooks = createHooks();

    const result = await handlePause(mockBox as any, "", hooks);

    expect(mockBox.pause).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(hooks.onLog).toHaveBeenCalledWith("Box box-1 paused.");
  });
});

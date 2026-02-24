import { describe, it, expect, vi } from "vitest";
import { handleDelete } from "../../repl-commands/delete.js";
import type { REPLHooks } from "../../repl-client.js";

function createHooks() {
  return {
    onLog: vi.fn() as unknown as REPLHooks["onLog"],
    onError: vi.fn() as unknown as REPLHooks["onError"],
    onStream: vi.fn() as unknown as REPLHooks["onStream"],
  };
}

describe("handleDelete", () => {
  it("deletes the box and returns true", async () => {
    const mockBox = {
      id: "box-1",
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const hooks = createHooks();

    const result = await handleDelete(mockBox as any, "", hooks);

    expect(mockBox.delete).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(hooks.onLog).toHaveBeenCalledWith("Box box-1 deleted.");
  });
});

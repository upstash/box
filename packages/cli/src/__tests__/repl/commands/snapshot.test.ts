import { describe, it, expect, vi } from "vitest";
import { handleSnapshot } from "../../../repl/commands/snapshot.js";
import type { REPLHooks } from "../../../repl/client.js";

function createHooks() {
  return {
    onLog: vi.fn() as unknown as REPLHooks["onLog"],
    onError: vi.fn() as unknown as REPLHooks["onError"],
    onStream: vi.fn() as unknown as REPLHooks["onStream"],
  };
}

describe("handleSnapshot", () => {
  it("creates snapshot with custom name", async () => {
    const mockBox = {
      snapshot: vi.fn().mockResolvedValue({ id: "snap-1", name: "my-snap" }),
    };
    const hooks = createHooks();

    await handleSnapshot(mockBox as any, "my-snap", hooks);

    expect(mockBox.snapshot).toHaveBeenCalledWith({ name: "my-snap" });
    expect(hooks.onLog).toHaveBeenCalledWith(expect.stringContaining("snap-1"));
    expect(hooks.onLog).toHaveBeenCalledWith(expect.stringContaining("my-snap"));
  });

  it("creates snapshot with default name when empty", async () => {
    const mockBox = {
      snapshot: vi.fn().mockResolvedValue({ id: "snap-2", name: "snapshot-1700000000" }),
    };
    const hooks = createHooks();

    await handleSnapshot(mockBox as any, "", hooks);

    const call = mockBox.snapshot.mock.calls[0]![0];
    expect(call.name).toMatch(/^snapshot-\d+$/);
  });
});

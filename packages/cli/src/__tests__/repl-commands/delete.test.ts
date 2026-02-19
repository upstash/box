import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleDelete } from "../../repl-commands/delete.js";

describe("handleDelete", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("deletes the box and returns true", async () => {
    const mockBox = {
      id: "box-1",
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handleDelete(mockBox as any, "");

    expect(mockBox.delete).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("Box box-1 deleted.");
  });
});

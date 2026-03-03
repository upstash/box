import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, ClaudeCode } from "../../index.js";

// Mock Box.create / Box.fromSnapshot so we never hit the network
const deleteMock = vi.fn().mockResolvedValue(undefined);
const fakeBox = { id: "fake-box", delete: deleteMock } as unknown as Box;

vi.spyOn(Box, "create").mockResolvedValue(fakeBox);
vi.spyOn(Box, "fromSnapshot").mockResolvedValue(fakeBox);

// Import after mocks are in place
const { withBox, withBoxFromSnapshot } = await import("./setup.js");

beforeEach(() => {
  deleteMock.mockClear();
});

describe("withBox", () => {
  it("propagates assertion errors from the callback", async () => {
    await expect(
      withBox(async () => {
        expect(1).toBe(2);
      }),
    ).rejects.toThrow();
  });

  it("propagates thrown errors from the callback", async () => {
    await expect(
      withBox(async () => {
        throw new Error("test error");
      }),
    ).rejects.toThrow("test error");
  });

  it("deletes the box even when the callback throws", async () => {
    await withBox(async () => {
      throw new Error("boom");
    }).catch(() => {});

    expect(deleteMock).toHaveBeenCalled();
  });

  it("deletes the box on success", async () => {
    await withBox(async () => {});

    expect(deleteMock).toHaveBeenCalled();
  });
});

describe("withBoxFromSnapshot", () => {
  it("propagates assertion errors from the callback", async () => {
    await expect(
      withBoxFromSnapshot("snap-123", async () => {
        expect(1).toBe(2);
      }),
    ).rejects.toThrow();
  });

  it("propagates thrown errors from the callback", async () => {
    await expect(
      withBoxFromSnapshot("snap-123", async () => {
        throw new Error("snapshot error");
      }),
    ).rejects.toThrow("snapshot error");
  });

  it("deletes the box even when the callback throws", async () => {
    await withBoxFromSnapshot("snap-123", async () => {
      throw new Error("boom");
    }).catch(() => {});

    expect(deleteMock).toHaveBeenCalled();
  });

  it("deletes the box on success", async () => {
    await withBoxFromSnapshot("snap-123", async () => {});

    expect(deleteMock).toHaveBeenCalled();
  });
});

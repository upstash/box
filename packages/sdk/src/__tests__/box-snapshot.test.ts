import { describe, it, expect, vi, afterEach } from "vitest";
import { BoxError } from "../client.js";
import { mockResponse, createTestBox } from "./helpers.js";

const TEST_SNAPSHOT = {
  id: "snap-1",
  name: "my-snapshot",
  box_id: "box-123",
  size_bytes: 1024,
  status: "ready" as const,
  created_at: 1700000000,
};

describe("Box snapshot operations", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("snapshot", () => {
    it("creates a snapshot (already ready)", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse(TEST_SNAPSHOT));

      const snap = await box.snapshot({ name: "my-snapshot" });
      expect(snap.id).toBe("snap-1");
      expect(snap.name).toBe("my-snapshot");
      expect(snap.status).toBe("ready");
    });

    it("polls until snapshot is ready", async () => {
      const { box, fetchMock } = await createTestBox();
      const creating = { ...TEST_SNAPSHOT, status: "creating" };
      const ready = { ...TEST_SNAPSHOT, status: "ready" };

      fetchMock
        .mockResolvedValueOnce(mockResponse(creating)) // POST
        .mockResolvedValueOnce(mockResponse({ snapshots: [ready] })); // poll listSnapshots

      const snap = await box.snapshot({ name: "my-snapshot" });
      expect(snap.status).toBe("ready");
    });

    it("throws on error status", async () => {
      const { box, fetchMock } = await createTestBox();
      const creating = { ...TEST_SNAPSHOT, status: "creating" };
      const errorSnap = { ...TEST_SNAPSHOT, status: "error" };

      fetchMock
        .mockResolvedValueOnce(mockResponse(creating))
        .mockResolvedValueOnce(mockResponse({ snapshots: [errorSnap] }));

      await expect(box.snapshot({ name: "test" })).rejects.toThrow(
        "Snapshot creation failed",
      );
    });
  });

  describe("listSnapshots", () => {
    it("returns snapshots", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ snapshots: [TEST_SNAPSHOT] }),
      );

      const snaps = await box.listSnapshots();
      expect(snaps).toHaveLength(1);
      expect(snaps[0]!.id).toBe("snap-1");
    });

    it("returns empty array when no snapshots field", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      const snaps = await box.listSnapshots();
      expect(snaps).toEqual([]);
    });
  });

  describe("deleteSnapshot", () => {
    it("deletes a snapshot", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.deleteSnapshot("snap-1");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/snapshots/snap-1");
      expect(init?.method).toBe("DELETE");
    });
  });
});

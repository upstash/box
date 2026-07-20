import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox, TEST_BOX_DATA } from "./helpers.js";

describe("box.labels", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("add", () => {
    it("sends POST with label and returns updated labels", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ message: "Label added", labels: ["beta", "x-team"] }),
      );

      const labels = await box.labels.add("x-team");

      expect(labels).toEqual(["beta", "x-team"]);
      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/config/labels");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string).label).toBe("x-team");
    });

    it("throws on duplicate label", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ error: "Label already added" }, 409));

      await expect(box.labels.add("beta")).rejects.toThrow("Label already added");
    });

    it("throws on invalid label", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ error: 'labels: label "has space" contains invalid characters' }, 400),
      );

      await expect(box.labels.add("has space")).rejects.toThrow("invalid characters");
    });
  });

  describe("remove", () => {
    it("sends DELETE and returns updated labels", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ message: "Label removed", labels: ["x-team"] }),
      );

      const labels = await box.labels.remove("beta");

      expect(labels).toEqual(["x-team"]);
      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/config/labels/beta");
      expect(init?.method).toBe("DELETE");
    });

    it("url-encodes the label", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ message: "Label removed", labels: [] }));

      await box.labels.remove("env:prod");

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/config/labels/env%3Aprod");
    });

    it("throws when label not found", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ error: "Label not found" }, 404));

      await expect(box.labels.remove("missing")).rejects.toThrow("Label not found");
    });
  });

  describe("list", () => {
    it("returns labels from box data", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ ...TEST_BOX_DATA, labels: ["beta", "x-team"] }),
      );

      const labels = await box.labels.list();

      expect(labels).toEqual(["beta", "x-team"]);
      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123");
      expect(init?.method).toBe("GET");
    });

    it("returns empty array when box has no labels", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ ...TEST_BOX_DATA }));

      expect(await box.labels.list()).toEqual([]);
    });
  });
});

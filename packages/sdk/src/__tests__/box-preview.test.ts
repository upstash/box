import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox } from "./helpers.js";

describe("Box preview operations", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("getPreviewUrl", () => {
    it("creates a public preview URL", async () => {
      const { box, fetchMock } = await createTestBox();
      const mockPreview = {
        url: "https://box-123-3000.preview.box.upstash.com",
        port: 3000,
      };
      fetchMock.mockResolvedValueOnce(mockResponse(mockPreview));

      const preview = await box.getPreviewUrl(3000);
      expect(preview.url).toBe("https://box-123-3000.preview.box.upstash.com");
      expect(preview.port).toBe(3000);
      expect(preview.token).toBeUndefined();
      expect(preview.username).toBeUndefined();
      expect(preview.password).toBeUndefined();

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.port).toBe(3000);
    });

    it("creates a preview URL with bearer token", async () => {
      const { box, fetchMock } = await createTestBox();
      const mockPreview = {
        url: "https://box-123-3000.preview.box.upstash.com",
        port: 3000,
        token: "63d8b153abc",
      };
      fetchMock.mockResolvedValueOnce(mockResponse(mockPreview));

      const preview = await box.getPreviewUrl(3000, { bearerToken: true });
      expect(preview.url).toBe("https://box-123-3000.preview.box.upstash.com");
      expect(preview.port).toBe(3000);
      expect(preview.token).toBe("63d8b153abc");

      const [, init] = fetchMock.mock.calls[1]!;
      const body = JSON.parse(init?.body as string);
      expect(body.bearer_token).toBe(true);
    });

    it("creates a preview URL with basic auth", async () => {
      const { box, fetchMock } = await createTestBox();
      const mockPreview = {
        url: "https://box-123-8080.preview.box.upstash.com",
        port: 8080,
        username: "user",
        password: "f0f145f0secret",
      };
      fetchMock.mockResolvedValueOnce(mockResponse(mockPreview));

      const preview = await box.getPreviewUrl(8080, { basicAuth: true });
      expect(preview.url).toBe("https://box-123-8080.preview.box.upstash.com");
      expect(preview.port).toBe(8080);
      expect(preview.username).toBe("user");
      expect(preview.password).toBe("f0f145f0secret");

      const [, init] = fetchMock.mock.calls[1]!;
      const body = JSON.parse(init?.body as string);
      expect(body.basic_auth).toBe(true);
    });

    it("creates a preview URL with both auth methods", async () => {
      const { box, fetchMock } = await createTestBox();
      const mockPreview = {
        url: "https://box-123-8080.preview.box.upstash.com",
        port: 8080,
        username: "user",
        password: "f0f145f0secret",
        token: "63d8b153abc",
      };
      fetchMock.mockResolvedValueOnce(mockResponse(mockPreview));

      const preview = await box.getPreviewUrl(8080, { bearerToken: true, basicAuth: true });
      expect(preview.url).toBe("https://box-123-8080.preview.box.upstash.com");
      expect(preview.port).toBe(8080);
      expect(preview.username).toBe("user");
      expect(preview.password).toBe("f0f145f0secret");
      expect(preview.token).toBe("63d8b153abc");

      const [, init] = fetchMock.mock.calls[1]!;
      const body = JSON.parse(init?.body as string);
      expect(body.bearer_token).toBe(true);
      expect(body.basic_auth).toBe(true);
    });
  });

  describe("listPreviews", () => {
    it("lists all preview URLs", async () => {
      const { box, fetchMock } = await createTestBox();
      const mockPreviews = [
        {
          url: "https://box-123-3000.preview.box.upstash.com",
          port: 3000,
        },
        {
          url: "https://box-123-8080.preview.box.upstash.com",
          port: 8080,
          username: "user",
          password: "secret",
        },
      ];
      fetchMock.mockResolvedValueOnce(mockResponse({ previews: mockPreviews }));

      const res = await box.listPreviews();
      expect(res.previews).toHaveLength(2);
      expect(res.previews[0]!.port).toBe(3000);
      expect(res.previews[1]!.port).toBe(8080);

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview");
      expect(init?.method).toBe("GET");
    });

    it("returns empty array when no previews", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ previews: [] }));

      const res = await box.listPreviews();
      expect(res.previews).toEqual([]);
    });
  });

  describe("deletePreview", () => {
    it("deletes a preview URL by port", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.deletePreview(3000);

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview/3000");
      expect(init?.method).toBe("DELETE");
    });
  });
});

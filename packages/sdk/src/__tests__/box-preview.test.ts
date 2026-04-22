import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox } from "./helpers.js";

describe("Box public URL operations", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("getPublicURL", () => {
    it("creates a public URL", async () => {
      const { box, fetchMock } = await createTestBox();
      const mockPublicUrl = {
        url: "https://box-123-3000.preview.box.upstash.com",
        port: 3000,
      };
      fetchMock.mockResolvedValueOnce(mockResponse(mockPublicUrl));

      const publicUrl = await box.getPublicURL(3000);
      expect(publicUrl.url).toBe("https://box-123-3000.preview.box.upstash.com");
      expect(publicUrl.port).toBe(3000);
      expect(publicUrl.token).toBeUndefined();
      expect(publicUrl.username).toBeUndefined();
      expect(publicUrl.password).toBeUndefined();

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.port).toBe(3000);
    });

    it("creates a public URL with bearer token", async () => {
      const { box, fetchMock } = await createTestBox();
      const mockPublicUrl = {
        url: "https://box-123-3000.preview.box.upstash.com",
        port: 3000,
        token: "63d8b153abc",
      };
      fetchMock.mockResolvedValueOnce(mockResponse(mockPublicUrl));

      const publicUrl = await box.getPublicURL(3000, { bearerToken: true });
      expect(publicUrl.token).toBe("63d8b153abc");

      const [, init] = fetchMock.mock.calls[1]!;
      const body = JSON.parse(init?.body as string);
      expect(body.bearer_token).toBe(true);
    });

    it("creates a public URL with basic auth", async () => {
      const { box, fetchMock } = await createTestBox();
      const mockPublicUrl = {
        url: "https://box-123-8080.preview.box.upstash.com",
        port: 8080,
        username: "user",
        password: "f0f145f0secret",
      };
      fetchMock.mockResolvedValueOnce(mockResponse(mockPublicUrl));

      const publicUrl = await box.getPublicURL(8080, { basicAuth: true });
      expect(publicUrl.username).toBe("user");
      expect(publicUrl.password).toBe("f0f145f0secret");

      const [, init] = fetchMock.mock.calls[1]!;
      const body = JSON.parse(init?.body as string);
      expect(body.basic_auth).toBe(true);
    });
  });

  describe("listPublicURLs", () => {
    it("lists all public URLs", async () => {
      const { box, fetchMock } = await createTestBox();
      const mockPreviews = [
        { url: "https://box-123-3000.preview.box.upstash.com", port: 3000 },
        {
          url: "https://box-123-8080.preview.box.upstash.com",
          port: 8080,
          username: "user",
          password: "secret",
        },
      ];
      fetchMock.mockResolvedValueOnce(mockResponse({ previews: mockPreviews }));

      const res = await box.listPublicURLs();
      expect(res.publicURLs).toHaveLength(2);
      expect(res.publicURLs[0]!.port).toBe(3000);
      expect(res.publicURLs[1]!.port).toBe(8080);

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview");
      expect(init?.method).toBe("GET");
    });
  });

  describe("deletePublicURL", () => {
    it("deletes a public URL by port", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.deletePublicURL(3000);

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview/3000");
      expect(init?.method).toBe("DELETE");
    });
  });

  describe("deprecated preview aliases", () => {
    it("getPreviewUrl delegates to getPublicURL", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ url: "https://box-123-3000.preview.box.upstash.com", port: 3000 }),
      );

      const preview = await box.getPreviewUrl(3000);
      expect(preview.port).toBe(3000);
    });

    it("listPreviews delegates to listPublicURLs", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          previews: [{ url: "https://box-123-3000.preview.box.upstash.com", port: 3000 }],
        }),
      );

      const res = await box.listPreviews();
      expect(res.previews).toHaveLength(1);
      expect(res.previews[0]!.port).toBe(3000);
    });

    it("deletePreview delegates to deletePublicURL", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.deletePreview(3000);

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview/3000");
      expect(init?.method).toBe("DELETE");
    });
  });
});

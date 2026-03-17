import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox } from "./helpers.js";

describe("Box preview operations", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("preview.create", () => {
    it("creates a preview URL without authentication", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          url: "https://box-123-3000.preview.upstash.com",
          port: 3000,
        }),
      );

      const preview = await box.preview.create({ port: 3000 });

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview");
      const body = JSON.parse(init?.body as string);
      expect(body.port).toBe(3000);
      expect(body.basic_auth).toBeUndefined();
      expect(body.bearer_token).toBeUndefined();
      expect(preview.url).toBe("https://box-123-3000.preview.upstash.com");
      expect(preview.port).toBe(3000);
    });

    it("creates a preview URL with basic auth", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          url: "https://box-123-8080.preview.upstash.com",
          port: 8080,
          username: "user",
          password: "secret123",
        }),
      );

      const preview = await box.preview.create({ port: 8080, basicAuth: true });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.port).toBe(8080);
      expect(body.basic_auth).toBe(true);
      expect(preview.username).toBe("user");
      expect(preview.password).toBe("secret123");
    });

    it("creates a preview URL with bearer token", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          url: "https://box-123-5000.preview.upstash.com",
          port: 5000,
          token: "bearer-token-xyz",
        }),
      );

      const preview = await box.preview.create({ port: 5000, bearerToken: true });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.port).toBe(5000);
      expect(body.bearer_token).toBe(true);
      expect(preview.token).toBe("bearer-token-xyz");
    });

    it("creates a preview URL with both auth methods", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          url: "https://box-123-4000.preview.upstash.com",
          port: 4000,
          username: "user",
          password: "pass123",
          token: "token-abc",
        }),
      );

      const preview = await box.preview.create({
        port: 4000,
        basicAuth: true,
        bearerToken: true,
      });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.basic_auth).toBe(true);
      expect(body.bearer_token).toBe(true);
      expect(preview.username).toBe("user");
      expect(preview.password).toBe("pass123");
      expect(preview.token).toBe("token-abc");
    });
  });

  describe("preview.list", () => {
    it("lists all preview URLs for a box", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          previews: [
            {
              id: "box-123-3000",
              box_id: "box-123",
              customer_id: "user-456",
              port: 3000,
              created_at: 1234567890,
            },
            {
              id: "box-123-8080",
              box_id: "box-123",
              customer_id: "user-456",
              port: 8080,
              username: "user",
              password: "secret",
              created_at: 1234567900,
            },
          ],
        }),
      );

      const previews = await box.preview.list();

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview");
      expect(previews).toHaveLength(2);
      expect(previews[0]!.port).toBe(3000);
      expect(previews[1]!.port).toBe(8080);
      expect(previews[1]!.username).toBe("user");
    });

    it("returns empty array when no previews exist", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ previews: [] }));

      const previews = await box.preview.list();

      expect(previews).toEqual([]);
    });
  });

  describe("preview.delete", () => {
    it("deletes a preview URL by port", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.preview.delete(3000);

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/preview/3000");
      expect(init?.method).toBe("DELETE");
    });
  });
});

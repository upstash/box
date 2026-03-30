import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox, TEST_BOX_DATA } from "./helpers.js";

describe("box.skills", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("add", () => {
    it("sends POST with skill_id", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ message: "Skill added" }));

      await box.skills.add("vercel/next.js/update-docs");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/config/skills");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.skill_id).toBe("vercel/next.js/update-docs");
    });

    it("throws on API error", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ error: "Invalid skill_id format" }, 400));

      await expect(box.skills.add("bad-format")).rejects.toThrow("Invalid skill_id format");
    });

    it("throws on duplicate skill", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ error: "Skill already enabled" }, 409));

      await expect(box.skills.add("vercel/next.js/update-docs")).rejects.toThrow(
        "Skill already enabled",
      );
    });
  });

  describe("remove", () => {
    it("sends DELETE with skill path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ message: "Skill removed" }));

      await box.skills.remove("vercel/next.js/update-docs");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123/config/skills/vercel/next.js/update-docs");
      expect(init?.method).toBe("DELETE");
    });

    it("throws on API error", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ error: "Skill not found" }, 404));

      await expect(box.skills.remove("vercel/next.js/update-docs")).rejects.toThrow(
        "Skill not found",
      );
    });
  });

  describe("list", () => {
    it("returns enabled skills from box data", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          ...TEST_BOX_DATA,
          enabled_skills: ["vercel/next.js/update-docs", "upstash/qstash-js/qstash-js"],
        }),
      );

      const skills = await box.skills.list();

      expect(skills).toEqual(["vercel/next.js/update-docs", "upstash/qstash-js/qstash-js"]);

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/v2/box/box-123");
      expect(init?.method).toBe("GET");
    });

    it("returns empty array when no skills enabled", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ ...TEST_BOX_DATA }));

      const skills = await box.skills.list();

      expect(skills).toEqual([]);
    });

    it("returns empty array when enabled_skills is explicitly empty", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ ...TEST_BOX_DATA, enabled_skills: [] }));

      const skills = await box.skills.list();

      expect(skills).toEqual([]);
    });
  });
});

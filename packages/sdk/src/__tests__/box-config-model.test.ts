import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox } from "./helpers.js";

describe("Box.configureModel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends PUT to /v2/box/:id/config/model", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({}));

    await box.configureModel("anthropic/claude-opus-4-5");

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toContain("/v2/box/box-123/config/model");
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("anthropic/claude-opus-4-5");
  });

  it("sends the correct model string", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({}));

    await box.configureModel("openai/gpt_5_4_codex");

    const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
    expect(body.model).toBe("openai/gpt_5_4_codex");
  });

  it("updates local modelConfig after success", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({}));

    await box.configureModel("anthropic/claude-opus-4-5");

    expect(box.modelConfig.model).toBe("anthropic/claude-opus-4-5");
  });
});

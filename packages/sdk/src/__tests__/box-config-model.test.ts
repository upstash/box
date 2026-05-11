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

    await box.configureModel("openai/gpt_5_4");

    const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
    expect(body.model).toBe("openai/gpt_5_4");
  });

  it("updates local modelConfig after success", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({}));

    await box.configureModel("anthropic/claude-opus-4-5");

    expect(box.modelConfig.model).toBe("anthropic/claude-opus-4-5");
  });
});

describe("Box.configureCustomHarness", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends PUT to /v2/box/:id/config/custom-runner", async () => {
    const { box, fetchMock } = await createTestBox({ agent: "custom", model: "custom/demo" });
    fetchMock.mockResolvedValueOnce(mockResponse({}));

    await box.configureCustomHarness({
      command: "node",
      args: ["/workspace/home/custom-harness.mjs"],
      protocol: "box-sse-v1",
    });

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toContain("/v2/box/box-123/config/custom-runner");
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(init?.body as string);
    expect(body.custom_runner).toEqual({
      command: "node",
      args: ["/workspace/home/custom-harness.mjs"],
      protocol: "box-sse-v1",
    });
    expect(box.modelConfig.harness).toBe("custom");
  });

  it("throws for non-custom boxes", async () => {
    const { box, fetchMock } = await createTestBox();

    await expect(
      box.configureCustomHarness({ command: "node", args: ["/workspace/home/custom-harness.mjs"] }),
    ).rejects.toThrow("Custom harness can only be configured on custom agent boxes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

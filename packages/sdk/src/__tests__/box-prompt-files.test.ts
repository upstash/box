import { describe, it, expect, vi, afterEach } from "vitest";
import { mockSSEResponse, mockResponse, createTestBox } from "./helpers.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CSV = resolve(__dirname, "integration/fixtures/sample.csv");

describe("box.agent.run — files (base64 JSON)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends base64 files in JSON body with media_type wire format", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "It's a cat" } },
      ]),
    );

    await box.agent.run({
      prompt: "What's in this image?",
      files: [
        { data: "iVBORw0KGgo=", mediaType: "image/png", filename: "cat.png" },
        { data: "JVBERi0xLjQ=", mediaType: "application/pdf" },
      ],
    });

    const [, runCall] = fetchMock.mock.calls;
    expect(runCall[1].headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(runCall[1].body as string);
    expect(body.prompt).toBe("What's in this image?");
    expect(body.files).toEqual([
      { data: "iVBORw0KGgo=", media_type: "image/png", filename: "cat.png" },
      { data: "JVBERi0xLjQ=", media_type: "application/pdf", filename: undefined },
    ]);
  });

  it("sends base64 files in webhook run", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(mockResponse({ status: "accepted", box_id: "box-123" }));

    await box.agent.run({
      prompt: "Describe this",
      files: [{ data: "abc123", mediaType: "image/jpeg", filename: "photo.jpg" }],
      webhook: { url: "https://example.com/hook" },
    });

    const [, runCall] = fetchMock.mock.calls;
    expect(runCall[1].headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(runCall[1].body as string);
    expect(body.files).toEqual([
      { data: "abc123", media_type: "image/jpeg", filename: "photo.jpg" },
    ]);
    expect(body.webhook).toBeDefined();
  });

  it("does not include files key when no files provided", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "ok" } },
      ]),
    );

    await box.agent.run({ prompt: "hello" });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.files).toBeUndefined();
  });
});

describe("box.agent.stream — files (base64 JSON)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends base64 files in stream request", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "It's a chart" } },
      ]),
    );

    const run = await box.agent.stream({
      prompt: "Analyze this chart",
      files: [{ data: "iVBORw0KGgo=", mediaType: "image/png", filename: "chart.png" }],
    });
    for await (const _ of run) {
      // consume
    }

    const [, runCall] = fetchMock.mock.calls;
    expect(runCall[1].headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(runCall[1].body as string);
    expect(body.files).toEqual([
      { data: "iVBORw0KGgo=", media_type: "image/png", filename: "chart.png" },
    ]);
  });

  it("does not include files key when no files provided", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "ok" } },
      ]),
    );

    const run = await box.agent.stream({ prompt: "hello" });
    for await (const _ of run) {
      // consume
    }

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.files).toBeUndefined();
  });
});

describe("box.agent.run — files (multipart file paths)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends local file as multipart FormData", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "3 rows" } },
      ]),
    );

    const run = await box.agent.run({
      prompt: "How many rows?",
      files: [FIXTURE_CSV],
    });

    expect(run.result).toBe("3 rows");
    expect(run.status).toBe("completed");

    const [, runCall] = fetchMock.mock.calls;
    // Multipart — no Content-Type header (browser/node sets boundary automatically)
    expect(runCall[1].headers["Content-Type"]).toBeUndefined();
    expect(runCall[1].body).toBeInstanceOf(FormData);
    const formData = runCall[1].body as FormData;
    expect(formData.get("prompt")).toBe("How many rows?");
    expect(formData.getAll("files")).toHaveLength(1);
    const file = formData.get("files") as File;
    expect(file.type).toBe("text/csv");
  });

  it("includes agent_options as JSON string in multipart form", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "ok" } },
      ]),
    );

    await box.agent.run({
      prompt: "Analyze",
      files: [FIXTURE_CSV],
      options: { maxTurns: 3 },
    });

    const formData = fetchMock.mock.calls[1]![1].body as FormData;
    expect(formData.get("agent_options")).toBe(JSON.stringify({ maxTurns: 3 }));
  });

  it("sends multipart FormData with webhook fields", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(mockResponse({ status: "accepted", box_id: "box-123" }));

    await box.agent.run({
      prompt: "Analyze",
      files: [FIXTURE_CSV],
      webhook: { url: "https://example.com/hook", headers: { "X-Test": "value" } },
    });

    const [, runCall] = fetchMock.mock.calls;
    expect(runCall[1].headers["Content-Type"]).toBeUndefined();
    expect(runCall[1].body).toBeInstanceOf(FormData);
    const formData = runCall[1].body as FormData;
    expect(formData.get("prompt")).toBe("Analyze");
    expect(formData.getAll("files")).toHaveLength(1);
    expect(formData.get("webhook")).toBe(
      JSON.stringify({ url: "https://example.com/hook", headers: { "X-Test": "value" } }),
    );
  });

  it("sends multiple file paths", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "done" } },
      ]),
    );

    await box.agent.run({
      prompt: "Compare these",
      files: [FIXTURE_CSV, FIXTURE_CSV],
    });

    const formData = fetchMock.mock.calls[1]![1].body as FormData;
    expect(formData.getAll("files")).toHaveLength(2);
  });
});

describe("box.agent.stream — files (multipart file paths)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends local file as multipart FormData in stream", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "Charlie" } },
      ]),
    );

    const run = await box.agent.stream({
      prompt: "Oldest person?",
      files: [FIXTURE_CSV],
    });

    const chunks = [];
    for await (const chunk of run) {
      chunks.push(chunk);
    }

    expect(run.result).toBe("Charlie");
    expect(run.status).toBe("completed");

    const [, runCall] = fetchMock.mock.calls;
    expect(runCall[1].headers["Content-Type"]).toBeUndefined();
    expect(runCall[1].body).toBeInstanceOf(FormData);
  });
});

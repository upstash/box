/**
 * Tests for the new per-box instance methods:
 *   box.listSteps()  – list agent commit steps
 *   box.stepDiff()   – diff for a specific step SHA
 *   box.cancelRun()  – cancel an in-progress run
 *   box.exec()       – workDir option
 *   box.streamRun()  – SSE streaming
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createAttachedBox } from "./helpers.js";
import type { Step, StepDiffResponse } from "../types.js";

const TEST_STEP: Step = {
    sha: "abc1234",
    prompt: "refactor the auth module",
    created_at: "2025-06-01T12:00:00Z",
};

// ──────────────────────────────────────────────────────────────────────────────
// box.listSteps
// ──────────────────────────────────────────────────────────────────────────────

describe("box.listSteps", () => {
    afterEach(() => vi.restoreAllMocks());

    it("GETs /v2/box/:id/steps and returns Step[]", async () => {
        const { box, fetchMock } = await createAttachedBox();
        fetchMock.mockResolvedValueOnce(mockResponse({ steps: [TEST_STEP] }));

        const steps = await box.listSteps();

        expect(steps).toHaveLength(1);
        expect(steps[0]!.sha).toBe("abc1234");
        expect(steps[0]!.prompt).toBe("refactor the auth module");

        const [url] = fetchMock.mock.calls[0]!;
        expect(url).toContain("/v2/box/box-123/steps");
    });

    it("returns an empty array when there are no steps", async () => {
        const { box, fetchMock } = await createAttachedBox();
        fetchMock.mockResolvedValueOnce(mockResponse({ steps: [] }));

        const steps = await box.listSteps();
        expect(steps).toEqual([]);
    });

    it("returns multiple steps in order", async () => {
        const { box, fetchMock } = await createAttachedBox();
        const steps: Step[] = [
            { sha: "sha1", prompt: "first task", created_at: "2025-01-01T00:00:00Z" },
            { sha: "sha2", prompt: "second task", created_at: "2025-01-02T00:00:00Z" },
        ];
        fetchMock.mockResolvedValueOnce(mockResponse({ steps }));

        const result = await box.listSteps();
        expect(result).toHaveLength(2);
        expect(result[0]!.sha).toBe("sha1");
        expect(result[1]!.sha).toBe("sha2");
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// box.stepDiff
// ──────────────────────────────────────────────────────────────────────────────

describe("box.stepDiff", () => {
    afterEach(() => vi.restoreAllMocks());

    it("GETs /v2/box/:id/steps/:sha/diff and returns StepDiffResponse", async () => {
        const { box, fetchMock } = await createAttachedBox();
        const diffResp: StepDiffResponse = {
            sha: "abc1234",
            diff: "--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-old\n+new",
        };
        fetchMock.mockResolvedValueOnce(mockResponse(diffResp));

        const result = await box.stepDiff("abc1234");

        expect(result.sha).toBe("abc1234");
        expect(result.diff).toContain("--- a/auth.ts");

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toContain("/v2/box/box-123/steps/abc1234/diff");
        expect(init?.method).toBe("GET");
    });

    it("includes the SHA in the URL path", async () => {
        const { box, fetchMock } = await createAttachedBox();
        fetchMock.mockResolvedValueOnce(mockResponse({ sha: "deadbeef", diff: "" }));

        await box.stepDiff("deadbeef");

        const [url] = fetchMock.mock.calls[0]!;
        expect(url).toContain("/steps/deadbeef/diff");
    });

    it("returns an empty diff string when there are no changes", async () => {
        const { box, fetchMock } = await createAttachedBox();
        fetchMock.mockResolvedValueOnce(mockResponse({ sha: "abc1234", diff: "" }));

        const result = await box.stepDiff("abc1234");
        expect(result.diff).toBe("");
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// box.cancelRun
// ──────────────────────────────────────────────────────────────────────────────

describe("box.cancelRun", () => {
    afterEach(() => vi.restoreAllMocks());

    it("POSTs to /v2/box/:id/runs/:runId/cancel", async () => {
        const { box, fetchMock } = await createAttachedBox();
        fetchMock.mockResolvedValueOnce(mockResponse({}));

        await box.cancelRun("run-abc");

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toContain("/v2/box/box-123/runs/run-abc/cancel");
        expect(init?.method).toBe("POST");
    });

    it("includes the runId in the URL", async () => {
        const { box, fetchMock } = await createAttachedBox();
        fetchMock.mockResolvedValueOnce(mockResponse({}));

        await box.cancelRun("run-xyz-999");

        const [url] = fetchMock.mock.calls[0]!;
        expect(url).toContain("/runs/run-xyz-999/cancel");
    });

    it("resolves to void on success", async () => {
        const { box, fetchMock } = await createAttachedBox();
        fetchMock.mockResolvedValueOnce(mockResponse({}));

        const result = await box.cancelRun("run-abc");
        expect(result).toBeUndefined();
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// box.exec – workDir option
// ──────────────────────────────────────────────────────────────────────────────

describe("box.exec with workDir", () => {
    afterEach(() => vi.restoreAllMocks());

    it("sends work_dir in the request body when provided", async () => {
        const { box, fetchMock } = await createAttachedBox();
        fetchMock.mockResolvedValueOnce(mockResponse({ exit_code: 0, output: "ok" }));

        await box.exec("ls -la", { workDir: "/workspace/src" });

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toContain("/v2/box/box-123/exec");
        const body = JSON.parse(init?.body as string);
        expect(body.command).toEqual(["sh", "-c", "ls -la"]);
        expect(body.work_dir).toBe("/workspace/src");
    });

    it("omits work_dir when not provided", async () => {
        const { box, fetchMock } = await createAttachedBox();
        fetchMock.mockResolvedValueOnce(mockResponse({ exit_code: 0, output: "ok" }));

        await box.exec("pwd");

        const [, init] = fetchMock.mock.calls[0]!;
        const body = JSON.parse(init?.body as string);
        expect(body.work_dir).toBeUndefined();
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// box.streamRun – SSE streaming
// ──────────────────────────────────────────────────────────────────────────────

/** Build a minimal ReadableStream from an array of SSE-formatted text chunks. */
function buildSseStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        },
    });
}

describe("box.streamRun", () => {
    afterEach(() => vi.restoreAllMocks());

    it("POSTs to /v2/box/:id/run/stream with the prompt in the body", async () => {
        const { box, fetchMock } = await createAttachedBox();

        fetchMock.mockResolvedValueOnce(
            new Response(buildSseStream([]), { status: 200 }),
        );

        const ctl = box.streamRun("refactor auth", { onText: () => { } });
        expect(ctl).toBeInstanceOf(AbortController);

        // give the async IIFE time to run
        await new Promise((r) => setTimeout(r, 20));

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toContain("/v2/box/box-123/run/stream");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.prompt).toBe("refactor auth");
    });

    it("fires onText for each 'text' SSE event", async () => {
        const { box, fetchMock } = await createAttachedBox();

        const sseData = [
            "event: text\ndata: {\"text\":\"Hello \"}\n\n",
            "event: text\ndata: {\"text\":\"world\"}\n\n",
        ];
        fetchMock.mockResolvedValueOnce(
            new Response(buildSseStream(sseData), { status: 200 }),
        );

        const received: string[] = [];
        await new Promise<void>((resolve) => {
            box.streamRun("say hello", {
                onText: (t) => {
                    received.push(t);
                    if (received.length === 2) resolve();
                },
            });
        });

        expect(received).toEqual(["Hello ", "world"]);
    });

    it("fires onTool when a 'tool' SSE event is received", async () => {
        const { box, fetchMock } = await createAttachedBox();

        const sseData = ["event: tool\ndata: {\"name\":\"WriteFile\"}\n\n"];
        fetchMock.mockResolvedValueOnce(
            new Response(buildSseStream(sseData), { status: 200 }),
        );

        const toolNames: string[] = [];
        await new Promise<void>((resolve) => {
            box.streamRun("write a file", {
                onText: () => { },
                onTool: (name) => {
                    toolNames.push(name);
                    resolve();
                },
            });
        });

        expect(toolNames).toEqual(["WriteFile"]);
    });

    it("fires onDone when the 'done' SSE event is received", async () => {
        const { box, fetchMock } = await createAttachedBox();

        const sseData = [
            "event: text\ndata: {\"text\":\"Done output\"}\n\n",
            "event: done\ndata: {\"output\":\"Done output\"}\n\n",
        ];
        fetchMock.mockResolvedValueOnce(
            new Response(buildSseStream(sseData), { status: 200 }),
        );

        let doneOutput = "";
        await new Promise<void>((resolve) => {
            box.streamRun("finish", {
                onText: () => { },
                onDone: (out) => {
                    doneOutput = out;
                    resolve();
                },
            });
        });

        expect(doneOutput).toBe("Done output");
    });

    it("fires onError when the 'error' SSE event is received", async () => {
        const { box, fetchMock } = await createAttachedBox();

        const sseData = ["event: error\ndata: {\"error\":\"agent crashed\"}\n\n"];
        fetchMock.mockResolvedValueOnce(
            new Response(buildSseStream(sseData), { status: 200 }),
        );

        let errMsg = "";
        await new Promise<void>((resolve) => {
            box.streamRun("crash", {
                onText: () => { },
                onError: (e) => {
                    errMsg = e;
                    resolve();
                },
            });
        });

        expect(errMsg).toBe("agent crashed");
    });

    it("fires onError when the HTTP response is not ok", async () => {
        const { box, fetchMock } = await createAttachedBox();

        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
        );

        let errMsg = "";
        await new Promise<void>((resolve) => {
            box.streamRun("prompt", {
                onText: () => { },
                onError: (e) => {
                    errMsg = e;
                    resolve();
                },
            });
        });

        expect(errMsg).toContain("unauthorized");
    });

    it("returns an AbortController that can cancel the stream", async () => {
        const { box, fetchMock } = await createAttachedBox();

        // Never-ending stream
        const neverStream = new ReadableStream({ start() { } });
        fetchMock.mockResolvedValueOnce(new Response(neverStream, { status: 200 }));

        const ctl = box.streamRun("long task", { onText: () => { } });
        expect(ctl).toBeInstanceOf(AbortController);
        ctl.abort(); // should not throw
    });
});


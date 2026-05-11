import { describe, expect, it } from "vitest";
import { runCustomHarness } from "../custom-harness.js";

describe("runCustomHarness", () => {
  it("parses backend args and emits box-sse-v1 events", async () => {
    let output = "";

    await runCustomHarness(
      async ({ prompt, model, sessionId, stream }, emit) => {
        emit.tool({ toolCallId: "tool-1", name: "custom", input: { model, sessionId, stream } });
        emit.toolResult({ toolCallId: "tool-1", output: "ok" });
        emit.reasoning("trace");
        emit.text(`CUSTOM_OK ${prompt}`);
        return { output: `CUSTOM_OK ${prompt}`, inputTokens: 2, outputTokens: 3, sessionId };
      },
      {
        argv: ["-p", "hello world", "--model", "custom/demo", "--session", "s1", "--stream"],
        write: (chunk) => {
          output += chunk;
        },
      },
    );

    expect(output).toContain('event: tool\ndata: {"toolCallId":"tool-1","name":"custom"');
    expect(output).toContain('event: tool_result\ndata: {"toolCallId":"tool-1","output":"ok"}');
    expect(output).toContain('event: thinking\ndata: {"text":"trace"}');
    expect(output).toContain('event: text\ndata: {"text":"CUSTOM_OK hello world"}');
    expect(output).toContain(
      'event: done\ndata: {"output":"CUSTOM_OK hello world","input_tokens":2,"output_tokens":3,"cached_input_tokens":0,"total_cost_usd":0,"session_id":"s1"}',
    );
  });

  it("emits error before rethrowing", async () => {
    let output = "";

    await expect(
      runCustomHarness(
        () => {
          throw new Error("boom");
        },
        {
          argv: ["-p", "hello", "--session", "s1"],
          write: (chunk) => {
            output += chunk;
          },
        },
      ),
    ).rejects.toThrow("boom");

    expect(output).toContain('event: error\ndata: {"error":"boom"');
    expect(output).toContain('"session_id":"s1"');
  });
});

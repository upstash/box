import { describe, it, expect } from "vitest";
import { z } from "zod/v3";
import { UPSTASH_BOX_API_KEY, withBox } from "./setup.js";
import { OpenAICodex } from "../../types.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("agent", () => {
  it.concurrent(
    "agent.run: returns result",
    () =>
      withBox(async (box) => {
        const run = await box.agent.run({
          prompt: "Reply with exactly: INTEGRATION_OK",
        });
        const result = run.result;
        expect(result).toBeTruthy();
      }),
    120000,
  );

  it.concurrent(
    "agent.stream: yields stream parts",
    () =>
      withBox(async (box) => {
        let text = "";
        let partCount = 0;
        for await (const part of box.agent.stream({
          prompt: "Reply with exactly: STREAM_OK",
        })) {
          partCount++;
          if (part.type === "text-delta") {
            text += part.text;
          }
        }
        expect(partCount).toBeGreaterThan(0);
        expect(text).toBeTruthy();
      }),
    120000,
  );

  it.concurrent(
    "agent.run: structured output with responseSchema",
    () =>
      withBox(async (box) => {
        const schema = z.object({
          message: z.string(),
          messageSize: z.number(),
          secretCookie: z.string(),
        });

        const run = await box.agent.run({
          prompt: "say hi",
          responseSchema: schema,
        });

        const result = run.result;
        expect(result).toEqual({
          message: expect.any(String),
          messageSize: expect.any(Number),
          secretCookie: expect.any(String),
        });
      }),
    120000,
  );
});

const OPENAI_MODEL = OpenAICodex.GPT_5_3_Codex_Spark;

describe.skip("agent (OpenAI)", () => {
  it.concurrent(
    "agent.run: returns result with OpenAI model",
    () =>
      withBox(
        async (box) => {
          const run = await box.agent.run({
            prompt: "Reply with exactly: OPENAI_OK",
          });
          expect(run.result).toBeTruthy();
        },
        { model: OPENAI_MODEL },
      ),
    120000,
  );

  it.concurrent(
    "agent.stream: yields stream parts with OpenAI model",
    () =>
      withBox(
        async (box) => {
          let text = "";
          let partCount = 0;
          for await (const part of box.agent.stream({
            prompt: "Reply with exactly: OPENAI_STREAM_OK",
          })) {
            partCount++;
            if (part.type === "text-delta") {
              text += part.text;
            }
          }
          expect(partCount).toBeGreaterThan(0);
          expect(text).toBeTruthy();
        },
        { model: OPENAI_MODEL },
      ),
    120000,
  );
});

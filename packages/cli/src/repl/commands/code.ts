import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Execute inline code (JS, TS, or Python) inside the box.
 *
 * Usage:
 *   /code js  console.log("hello")
 *   /code ts  const x: number = 42; console.log(x)
 *   /code python  print("hello")
 */
export async function* handleCode(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  if (!args) {
    yield {
      type: "log",
      message:
        "Usage: /code <js|ts|python> <code>\n\nExamples:\n  /code js console.log(1 + 2)\n  /code ts const x: number = 42; console.log(x)\n  /code python print('hello')",
    };
    return;
  }

  const spaceIdx = args.indexOf(" ");
  if (spaceIdx === -1) {
    yield {
      type: "log",
      message: "Usage: /code <js|ts|python> <code>",
    };
    return;
  }

  const language = args.slice(0, spaceIdx).toLowerCase();
  const code = args.slice(spaceIdx + 1);

  if (language !== "js" && language !== "ts" && language !== "python") {
    yield {
      type: "error",
      message: `Unsupported language "${language}". Supported: js, ts, python`,
    };
    return;
  }

  const result = await box.exec.code({ code, lang: language });

  if (result.output) {
    yield { type: "log", message: result.output };
  }
  if (result.error) {
    yield { type: "error", message: result.error };
  }
  if (!result.output && !result.error) {
    yield { type: "log", message: `(exit code: ${result.exit_code})` };
  }
}

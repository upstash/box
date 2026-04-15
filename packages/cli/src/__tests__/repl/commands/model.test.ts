import { describe, it, expect, vi } from "vitest";
import { handleModel } from "../../../repl/commands/model.js";
import { collectEvents } from "../helpers.js";

describe("handleModel", () => {
  it("yields error when no args", async () => {
    const mockBox = {} as any;
    const events = await collectEvents(handleModel(mockBox, ""));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({ type: "error", message: expect.stringContaining("Usage") }),
    );
  });

  it("yields error when only one arg (missing model)", async () => {
    const mockBox = {} as any;
    const events = await collectEvents(handleModel(mockBox, "claude-code"));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({ type: "error", message: expect.stringContaining("Usage") }),
    );
  });

  it("calls configureModel with the model (second arg)", async () => {
    const mockBox = {
      configureModel: vi.fn().mockResolvedValue(undefined),
    };

    const events = await collectEvents(
      handleModel(mockBox as any, "claude-code anthropic/claude-opus-4-5"),
    );

    expect(mockBox.configureModel).toHaveBeenCalledWith("anthropic/claude-opus-4-5");
    expect(events).toContainEqual({
      type: "log",
      message: "Model changed to anthropic/claude-opus-4-5",
    });
  });

  it("handles extra whitespace in args", async () => {
    const mockBox = {
      configureModel: vi.fn().mockResolvedValue(undefined),
    };

    const events = await collectEvents(
      handleModel(mockBox as any, "  codex   openai/gpt_5_3_codex  "),
    );

    expect(mockBox.configureModel).toHaveBeenCalledWith("openai/gpt_5_3_codex");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "log", message: "Model changed to openai/gpt_5_3_codex" }),
    );
  });
});

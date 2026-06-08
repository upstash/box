import { describe, expect, it } from "vitest";
import { Agent, CursorModel } from "@upstash/box";
import { MODEL_OPTIONS_BY_AGENT } from "../models.js";

describe("MODEL_OPTIONS_BY_AGENT", () => {
  it("includes Cursor models", () => {
    const cursorModels = MODEL_OPTIONS_BY_AGENT[Agent.Cursor].flatMap((group) => group.options);

    expect(cursorModels).toContainEqual({
      value: CursorModel.Composer_2_5,
      label: "Composer 2.5",
    });
  });
});

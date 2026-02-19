import { describe, it, expect } from "vitest";
import { formatJSON, formatRaw } from "../output.js";

describe("formatJSON", () => {
  it("formats object as pretty JSON", () => {
    const result = formatJSON({ id: "box-1", status: "running" });
    expect(result).toBe(JSON.stringify({ id: "box-1", status: "running" }, null, 2));
  });

  it("formats array", () => {
    const result = formatJSON([1, 2, 3]);
    expect(result).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("formats null", () => {
    expect(formatJSON(null)).toBe("null");
  });
});

describe("formatRaw", () => {
  it("returns text as-is", () => {
    expect(formatRaw("hello world")).toBe("hello world");
  });

  it("preserves whitespace", () => {
    expect(formatRaw("  spaces  ")).toBe("  spaces  ");
  });
});

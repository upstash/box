import { describe, it, expect } from "vitest";
import { levenshtein, fuzzyMatch } from "../../utils/fuzzy.js";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("returns length for empty comparison", () => {
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("returns 1 for single character difference", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  it("returns correct distance for insertions", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  it("returns correct distance for deletions", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  it("handles multi-character edits", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("fuzzyMatch", () => {
  const commands = ["run", "exec", "files", "git", "snapshot", "pause", "delete"];

  it("returns exact match first", () => {
    const result = fuzzyMatch("run", commands);
    expect(result[0]).toBe("run");
  });

  it("returns close matches sorted by distance", () => {
    const result = fuzzyMatch("ru", commands);
    expect(result).toContain("run");
  });

  it("returns empty array when nothing is close", () => {
    const result = fuzzyMatch("xyzxyzxyz", commands, 2);
    expect(result).toEqual([]);
  });

  it("is case insensitive", () => {
    const result = fuzzyMatch("RUN", commands);
    expect(result).toContain("run");
  });

  it("finds 'pause' for 'pase' (typo)", () => {
    const result = fuzzyMatch("pase", commands);
    expect(result).toContain("pause");
  });

  it("respects maxDistance parameter", () => {
    const result = fuzzyMatch("xyz", commands, 1);
    expect(result).toEqual([]);
  });
});

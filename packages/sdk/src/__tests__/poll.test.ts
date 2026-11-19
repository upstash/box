import { describe, it, expect } from "vitest";
import { pollDelay } from "../poll.js";

describe("pollDelay", () => {
  it("starts short and grows", () => {
    expect([0, 1, 2, 3].map(pollDelay)).toEqual([100, 150, 225, 338]);
  });

  it("never waits longer than 2 seconds", () => {
    expect(pollDelay(7)).toBe(1709);
    expect(pollDelay(8)).toBe(2000);
    expect(pollDelay(50)).toBe(2000);
  });
});

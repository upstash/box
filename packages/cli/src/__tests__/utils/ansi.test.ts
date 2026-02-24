import { describe, it, expect } from "vitest";
import {
  bold,
  dim,
  cyan,
  green,
  red,
  yellow,
  magenta,
  gray,
  stripAnsi,
  cursorUp,
  cursorDown,
  eraseLine,
} from "../../utils/ansi.js";

describe("ansi color helpers", () => {
  it("bold wraps with correct codes", () => {
    expect(bold("hello")).toBe("\x1b[1mhello\x1b[22m");
  });

  it("dim wraps with correct codes", () => {
    expect(dim("hello")).toBe("\x1b[2mhello\x1b[22m");
  });

  it("cyan wraps with correct codes", () => {
    expect(cyan("hello")).toBe("\x1b[36mhello\x1b[39m");
  });

  it("green wraps with correct codes", () => {
    expect(green("hello")).toBe("\x1b[32mhello\x1b[39m");
  });

  it("red wraps with correct codes", () => {
    expect(red("hello")).toBe("\x1b[31mhello\x1b[39m");
  });

  it("yellow wraps with correct codes", () => {
    expect(yellow("hello")).toBe("\x1b[33mhello\x1b[39m");
  });

  it("magenta wraps with correct codes", () => {
    expect(magenta("hello")).toBe("\x1b[35mhello\x1b[39m");
  });

  it("gray wraps with correct codes", () => {
    expect(gray("hello")).toBe("\x1b[90mhello\x1b[39m");
  });
});

describe("stripAnsi", () => {
  it("removes color codes", () => {
    expect(stripAnsi(bold(cyan("hello")))).toBe("hello");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("strips cursor control sequences", () => {
    expect(stripAnsi(`${cursorUp(3)}hello${eraseLine}`)).toBe("hello");
  });
});

describe("cursor helpers", () => {
  it("cursorUp generates correct sequence", () => {
    expect(cursorUp(2)).toBe("\x1b[2A");
  });

  it("cursorDown generates correct sequence", () => {
    expect(cursorDown(3)).toBe("\x1b[3B");
  });

  it("eraseLine is correct", () => {
    expect(eraseLine).toBe("\x1b[2K");
  });
});

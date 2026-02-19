import { describe, it, expect } from "vitest";
import { BoxError } from "../client.js";

describe("BoxError", () => {
  it("creates error with message", () => {
    const err = new BoxError("something went wrong");
    expect(err.message).toBe("something went wrong");
    expect(err.name).toBe("BoxError");
    expect(err.statusCode).toBeUndefined();
  });

  it("creates error with message and status code", () => {
    const err = new BoxError("not found", 404);
    expect(err.message).toBe("not found");
    expect(err.statusCode).toBe(404);
  });

  it("is an instance of Error", () => {
    const err = new BoxError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BoxError);
  });

  it("has a stack trace", () => {
    const err = new BoxError("stack test");
    expect(err.stack).toBeDefined();
  });
});

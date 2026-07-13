import { describe, it, expect } from "vitest";
import { z as z3 } from "zod/v3";
import { z as z4 } from "zod/v4";
import { parseErrorResponse, toJsonSchema } from "../client.js";
import { mockResponse } from "./helpers.js";

describe("parseErrorResponse", () => {
  it("extracts error from JSON response", async () => {
    const resp = mockResponse({ error: "bad request" }, 400);
    const msg = await parseErrorResponse(resp);
    expect(msg).toBe("bad request");
  });

  it("falls back to status code when no error field", async () => {
    const resp = mockResponse({}, 500);
    const msg = await parseErrorResponse(resp);
    expect(msg).toBe("Request failed with status 500");
  });

  it("falls back to status code on invalid JSON", async () => {
    const resp = {
      ...mockResponse({}, 502),
      json: () => Promise.reject(new Error("invalid json")),
    } as Response;
    const msg = await parseErrorResponse(resp);
    expect(msg).toBe("Request failed with status 502");
  });
});

describe("toJsonSchema", () => {
  it("converts a zod object schema to JSON Schema", () => {
    const schema = z3.object({
      name: z3.string(),
      age: z3.number(),
      active: z3.boolean(),
    });
    const result = toJsonSchema(schema);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("object");
    expect(result!.properties).toEqual({
      name: { type: "string" },
      age: { type: "number" },
      active: { type: "boolean" },
    });
    expect(result!.required).toContain("name");
    expect(result!.required).toContain("age");
    expect(result!.required).toContain("active");
    expect(result!.additionalProperties).toBe(false);
  });

  it("converts a Zod 4 object schema to JSON Schema", () => {
    const result = toJsonSchema(z4.object({ name: z4.string(), age: z4.number() }));
    expect(result).toMatchObject({
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name", "age"],
      additionalProperties: false,
    });
  });

  it("returns null for a non-zod schema", () => {
    const schema = { parse: (d: unknown) => d };
    expect(toJsonSchema(schema)).toBeNull();
  });

  it("handles array types", () => {
    const schema = z3.object({
      items: z3.array(z3.string()),
    });
    const result = toJsonSchema(schema);
    expect(result).not.toBeNull();
    const items = (result!.properties as Record<string, unknown>).items as Record<string, unknown>;
    expect(items.type).toBe("array");
    expect(items.items).toEqual({ type: "string" });
  });

  it("handles optional fields", () => {
    const schema = z3.object({
      name: z3.string(),
      nickname: z3.string().optional(),
    });
    const result = toJsonSchema(schema);
    expect(result).not.toBeNull();
    expect(result!.required).toContain("name");
    expect(result!.required).not.toContain("nickname");
  });

  it("strips $schema key from output", () => {
    const schema = z3.object({ name: z3.string() });
    const result = toJsonSchema(schema);
    expect(result).not.toBeNull();
    expect(result!.$schema).toBeUndefined();
  });
});

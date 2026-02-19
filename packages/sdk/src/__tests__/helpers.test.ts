import { describe, it, expect } from "vitest";
import { parseErrorResponse, extractSchemaShape, zodTypeToExample } from "../client.js";
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

describe("extractSchemaShape", () => {
  it("extracts shape from zod-like schema", () => {
    const schema = {
      parse: (d: unknown) => d,
      shape: {
        name: { _def: { typeName: "ZodString" } },
        age: { _def: { typeName: "ZodNumber" } },
        active: { _def: { typeName: "ZodBoolean" } },
      },
    };
    const result = extractSchemaShape(schema);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.name).toBe("string");
    expect(parsed.age).toBe("number");
    expect(parsed.active).toBe("boolean");
  });

  it("returns null for schema without shape", () => {
    const schema = { parse: (d: unknown) => d };
    expect(extractSchemaShape(schema)).toBeNull();
  });

  it("handles array types", () => {
    const schema = {
      parse: (d: unknown) => d,
      shape: {
        items: { _def: { typeName: "ZodArray", type: { _def: { typeName: "ZodString" } } } },
      },
    };
    const result = extractSchemaShape(schema);
    const parsed = JSON.parse(result!);
    expect(parsed.items).toBe("[string]");
  });
});

describe("zodTypeToExample", () => {
  it("returns 'string' for ZodString", () => {
    expect(zodTypeToExample({ _def: { typeName: "ZodString" } })).toBe("string");
  });

  it("returns 'number' for ZodNumber", () => {
    expect(zodTypeToExample({ _def: { typeName: "ZodNumber" } })).toBe("number");
  });

  it("returns 'boolean' for ZodBoolean", () => {
    expect(zodTypeToExample({ _def: { typeName: "ZodBoolean" } })).toBe("boolean");
  });

  it("returns 'any' for unknown type", () => {
    expect(zodTypeToExample({ _def: { typeName: "ZodUnknown" } })).toBe("any");
  });

  it("returns 'any' for null/undefined", () => {
    expect(zodTypeToExample(null)).toBe("any");
    expect(zodTypeToExample(undefined)).toBe("any");
  });
});

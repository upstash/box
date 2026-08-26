import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BoxOutputReader } from "../src/output.js";
import { argvWithRemovals, removedEnvNames, sessionEnv } from "../src/process.js";

const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));

describe("BoxOutputReader", () => {
  it("returns everything while under the cap", () => {
    const reader = new BoxOutputReader(1_024);
    reader.push(bytes("hello "));
    reader.push(bytes("world"));
    const read = reader.readFrom(0);
    expect(read).toMatchObject({ text: "hello world", nextOffset: 11, lossy: false });
    expect(reader.size).toBe(11);
  });

  it("reads are non-consuming and resume from an offset", () => {
    const reader = new BoxOutputReader(1_024);
    reader.push(bytes("first"));
    const first = reader.readFrom(0);
    expect(reader.readFrom(0).text).toBe("first");
    reader.push(bytes("second"));
    expect(reader.readFrom(first.nextOffset).text).toBe("second");
  });

  it("keeps the tail and reports loss once the cap is passed", () => {
    const reader = new BoxOutputReader(4);
    reader.push(bytes("abcdefgh"));
    const read = reader.readFrom(0);
    expect(read.text).toBe("efgh");
    expect(read.lossy).toBe(true);
    expect(read.nextOffset).toBe(8);
    // Phase 0 keeps no spill file, so a lossy read advertises no recovery path.
    expect(read.spillPath).toBeUndefined();
  });

  it("trims across chunk boundaries rather than dropping a whole chunk", () => {
    const reader = new BoxOutputReader(5);
    reader.push(bytes("abc"));
    reader.push(bytes("def"));
    expect(reader.readFrom(0).text).toBe("bcdef");
  });

  it("drops a chunk entirely when a later one covers the cap", () => {
    const reader = new BoxOutputReader(3);
    reader.push(bytes("abc"));
    reader.push(bytes("xyz"));
    expect(reader.readFrom(0).text).toBe("xyz");
    expect(reader.size).toBe(6);
  });

  it("ignores empty pushes", () => {
    const reader = new BoxOutputReader(8);
    reader.push(new Uint8Array(0));
    expect(reader.readFrom(0)).toMatchObject({ text: "", nextOffset: 0, lossy: false });
  });

  it("reads past the end as empty rather than negative", () => {
    const reader = new BoxOutputReader(8);
    reader.push(bytes("abc"));
    expect(reader.readFrom(99).text).toBe("");
  });
});

describe("sessionEnv", () => {
  it("sends only the caller's explicit entries", () => {
    process.env.BOX_UNIT_HOST_AMBIENT = "from-host";
    try {
      expect(sessionEnv({ EXPLICIT: "yes" })).toEqual(["EXPLICIT=yes"]);
      expect(sessionEnv(undefined)).toEqual([]);
      expect(sessionEnv({})).toEqual([]);
    } finally {
      delete process.env.BOX_UNIT_HOST_AMBIENT;
    }
  });

  it("does not transport a tombstone as a value", () => {
    // A blank `GONE=` would leave the name present but empty, which is not what
    // the seam means by removal; the wrapper below unsets it instead.
    expect(sessionEnv({ GONE: undefined })).toEqual([]);
    expect(sessionEnv({ GONE: undefined, KEPT: "yes" })).toEqual(["KEPT=yes"]);
  });

  it("rejects names and values the transport cannot carry", () => {
    expect(() => sessionEnv({ "": "x" })).toThrow(/invalid environment name/);
    expect(() => sessionEnv({ "A=B": "x" })).toThrow(/invalid environment name/);
    expect(() => sessionEnv({ "A\0B": "x" })).toThrow(/invalid environment name/);
    expect(() => sessionEnv({ OK: "has\0nul" })).toThrow(/contains NUL/);
  });

  it("carries a newline, which the server accepts", () => {
    expect(sessionEnv({ MULTI: "a\nb" })).toEqual(["MULTI=a\nb"]);
  });
});

describe("environment removals", () => {
  it("collects tombstoned names in spec order", () => {
    expect(removedEnvNames({ A: undefined, B: "set", C: undefined })).toEqual(["A", "C"]);
    expect(removedEnvNames({ B: "set" })).toEqual([]);
    expect(removedEnvNames(undefined)).toEqual([]);
  });

  it("leaves argv untouched when nothing is removed", () => {
    expect(argvWithRemovals(["/bin/echo", "hi"], [])).toEqual(["/bin/echo", "hi"]);
  });

  it("unsets names in the child rather than blanking them", () => {
    expect(argvWithRemovals(["/bin/echo", "hi"], ["A", "B"])).toEqual([
      "/usr/bin/env",
      "-u",
      "A",
      "-u",
      "B",
      "--",
      "/bin/echo",
      "hi",
    ]);
  });
});

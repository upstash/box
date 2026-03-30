import { describe, it, expect, afterAll } from "vitest";
import { Box, EphemeralBox } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("EphemeralBox.create — size", () => {
  const boxes: EphemeralBox[] = [];

  afterAll(async () => {
    await Promise.allSettled(boxes.map((b) => b.delete()));
  }, 30000);

  it("creates an ephemeral box with default size (small)", async () => {
    const box = await EphemeralBox.create({ apiKey: UPSTASH_BOX_API_KEY!, ttl: 300 });
    boxes.push(box);

    const fetched = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(fetched.size).toBe("small");
  }, 30000);

  it("creates an ephemeral box with medium size", async () => {
    const box = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      size: "medium",
      ttl: 300,
    });
    boxes.push(box);

    const fetched = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(fetched.size).toBe("medium");
  }, 30000);

  it("creates an ephemeral box with large size", async () => {
    const box = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      size: "large",
      ttl: 300,
    });
    boxes.push(box);

    const fetched = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(fetched.size).toBe("large");
  }, 30000);
});

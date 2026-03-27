import { describe, it, expect, afterAll } from "vitest";
import { Box } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.create — size", () => {
  const boxes: Box[] = [];

  afterAll(async () => {
    await Promise.allSettled(boxes.map((b) => b.delete()));
  }, 30000);

  it("creates a small box (default)", async () => {
    const box = await Box.create({ apiKey: UPSTASH_BOX_API_KEY! });
    boxes.push(box);

    expect(box.size).toBe("small");

    const fetched = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(fetched.size).toBe("small");
  }, 120000);

  it("creates a medium box", async () => {
    const box = await Box.create({ apiKey: UPSTASH_BOX_API_KEY!, size: "medium" });
    boxes.push(box);

    expect(box.size).toBe("medium");

    const fetched = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(fetched.size).toBe("medium");
  }, 120000);

  it("creates a large box", async () => {
    const box = await Box.create({ apiKey: UPSTASH_BOX_API_KEY!, size: "large" });
    boxes.push(box);

    expect(box.size).toBe("large");

    const fetched = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(fetched.size).toBe("large");
  }, 120000);

  it("size appears in Box.list results", async () => {
    const allBoxes = await Box.list({ apiKey: UPSTASH_BOX_API_KEY! });
    for (const b of boxes) {
      const found = allBoxes.find((lb) => lb.id === b.id);
      expect(found).toBeDefined();
      expect(found!.size).toBe(b.size);
    }
  });
});

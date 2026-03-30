import { describe, it, expect } from "vitest";
import { Box, EphemeralBox } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.delete (static)", () => {
  it("deletes a single box by ID", async () => {
    const box = await EphemeralBox.create({ apiKey: UPSTASH_BOX_API_KEY!, ttl: 300 });

    await Box.delete({ apiKey: UPSTASH_BOX_API_KEY!, boxIds: box.id });

    const boxes = await Box.list({ apiKey: UPSTASH_BOX_API_KEY! });
    expect(boxes.find((b) => b.id === box.id)).toBeUndefined();
  }, 60000);

  it("deletes multiple boxes by ID", async () => {
    const [b1, b2] = await Promise.all([
      EphemeralBox.create({ apiKey: UPSTASH_BOX_API_KEY!, ttl: 300 }),
      EphemeralBox.create({ apiKey: UPSTASH_BOX_API_KEY!, ttl: 300 }),
    ]);

    await Box.delete({ apiKey: UPSTASH_BOX_API_KEY!, boxIds: [b1.id, b2.id] });

    const boxes = await Box.list({ apiKey: UPSTASH_BOX_API_KEY! });
    expect(boxes.find((b) => b.id === b1.id)).toBeUndefined();
    expect(boxes.find((b) => b.id === b2.id)).toBeUndefined();
  }, 60000);
});

import { describe, it, expect } from "vitest";
import { Box, EphemeralBox } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box.deleteAll", () => {
  it("deletes all boxes", async () => {
    // Create a couple of throwaway boxes
    await Promise.all([
      EphemeralBox.create({ apiKey: UPSTASH_BOX_API_KEY!, ttl: 300 }),
      EphemeralBox.create({ apiKey: UPSTASH_BOX_API_KEY!, ttl: 300 }),
    ]);

    await Box.deleteAll({ apiKey: UPSTASH_BOX_API_KEY! });

    const boxes = await Box.list({ apiKey: UPSTASH_BOX_API_KEY! });
    expect(boxes).toHaveLength(0);
  }, 60000);
});

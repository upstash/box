import { describe, it, expect, afterAll } from "vitest";
import { Box } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

const options = { apiKey: UPSTASH_BOX_API_KEY! };

describe.skipIf(!UPSTASH_BOX_API_KEY)("Box settings env vars", () => {
  const testKey = `SDK_TEST_KEY_${Date.now()}`;

  afterAll(async () => {
    try {
      await Box.deleteEnv(testKey, options);
    } catch {
      // cleanup best-effort
    }
  });

  it("sets a user-level env var", async () => {
    await expect(Box.setEnv(testKey, "test-value", options)).resolves.toBeUndefined();
  });

  it("lists env vars and includes the set key", async () => {
    const vars = await Box.listEnv(options);
    expect(vars).toHaveProperty(testKey);
  });

  it("deletes the env var", async () => {
    await expect(Box.deleteEnv(testKey, options)).resolves.toBeUndefined();
  });

  it("key is no longer present after delete", async () => {
    const vars = await Box.listEnv(options);
    expect(vars).not.toHaveProperty(testKey);
  });

  it("setAllEnv full-replaces env vars", async () => {
    const key1 = `SDK_ALL_A_${Date.now()}`;
    const key2 = `SDK_ALL_B_${Date.now()}`;

    await Box.setAllEnv({ [key1]: "val-a", [key2]: "val-b" }, options);
    const vars = await Box.listEnv(options);
    expect(vars).toHaveProperty(key1);
    expect(vars).toHaveProperty(key2);

    // cleanup
    await Box.setAllEnv({}, options);
  });
});

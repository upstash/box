import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: [resolve(__dirname, "src/**/*.integration.test.ts")],
    // These spawn the built binary against a real box, so they are slow.
    testTimeout: 180000,
    hookTimeout: 180000,
    // One box is shared by the suite; running files in parallel would race on
    // its filesystem and its .box pin.
    fileParallelism: false,
  },
});

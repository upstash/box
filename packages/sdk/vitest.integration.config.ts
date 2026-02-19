import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: [resolve(__dirname, "src/**/*.integration.test.ts")],
    testTimeout: 120000,
  },
});

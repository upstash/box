import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests spawn the binary against a real box; they run from
    // vitest.integration.config.ts, not from the unit suite.
    exclude: ["src/**/*.integration.test.ts", "node_modules"],
  },
});

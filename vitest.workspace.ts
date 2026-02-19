import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/sdk/vitest.config.ts",
  "packages/cli/vitest.config.ts",
]);

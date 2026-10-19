import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "node_modules"],
    // Type-level tests (*.test-d.ts) are checked by tsc, so @ts-expect-error and
    // expectTypeOf assertions are enforced; regular tests are only transpiled.
    typecheck: {
      enabled: true,
      include: ["src/**/*.test-d.ts"],
      tsconfig: "./tsconfig.typecheck.json",
    },
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    environment: "node",
    // Several suites drive real git processes in temporary repositories, which is slow on Windows.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

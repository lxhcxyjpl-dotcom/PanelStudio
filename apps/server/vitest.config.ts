import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 45_000,
    maxWorkers: 2,
    include: ["src/**/*.test.ts"],
  },
});

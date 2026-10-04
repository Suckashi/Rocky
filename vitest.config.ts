import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    // Hosted runners show rare timing flakes; local runs never retry.
    retry: process.env.CI ? 2 : 0,
  },
});

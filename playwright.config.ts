import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 30000,
  webServer: {
    command:
      "node --import tsx tests/e2e/seed-reconciliation.ts && node tests/e2e/dev.mjs",
    url: "http://127.0.0.1:3210/api/v1/health",
    reuseExistingServer: false,
    env: { ROCKY_DATA_DIR: ".rocky-e2e" },
    timeout: 60000,
  },
  use: {
    baseURL: "http://127.0.0.1:3210",
    launchOptions: process.env.ROCKY_TEST_BROWSER
      ? { executablePath: process.env.ROCKY_TEST_BROWSER }
      : {},
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
});

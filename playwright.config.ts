import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
// Each run owns fresh fixture data; retain prior runs for diagnosis.
const dataRoot = (process.env.ROCKY_E2E_ROOT ??= join(
  tmpdir(),
  "rocky-browser-" + randomUUID(),
  ".rocky-e2e",
));
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  // Hosted runners show rare timing flakes; retries are reported as flaky.
  retries: process.env.CI ? 2 : 0,
  timeout: 30000,
  webServer: {
    command:
      "node --import tsx tests/e2e/seed-reconciliation.ts && node tests/e2e/dev.mjs",
    url: "http://127.0.0.1:3210/api/v1/health",
    reuseExistingServer: false,
    env: { ROCKY_DATA_DIR: dataRoot },
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

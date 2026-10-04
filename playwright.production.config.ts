import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: [
    "computer-panel.spec.ts",
    "skills.spec.ts",
    "learning.spec.ts",
    "memory.spec.ts",
    "mcp-work.spec.ts",
    "workspaces.spec.ts",
    "workspace-read.spec.ts",
    "workspace-write.spec.ts",
    "workspace-worktree.spec.ts",
    "html-preview.spec.ts",
    "background-presence.spec.ts",
  ],
  workers: 1,
  projects: [{ name: "production-path" }],
  timeout: 30000,
  webServer: {
    command: "node tests/e2e/dev.mjs --production",
    url: "http://127.0.0.1:3210/api/v1/health",
    reuseExistingServer: false,
    env: {
      ROCKY_DATA_DIR: process.env.ROCKY_E2E_DATA_DIR ?? ".rocky-e2e-production",
    },
    timeout: 60000,
  },
  use: base.use,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/production-e2e.json" }],
  ],
});

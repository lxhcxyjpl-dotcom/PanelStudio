import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.PANELSTUDIO_E2E_WEB_PORT ?? 5173);
const webUrl = "http://127.0.0.1:" + webPort;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  globalSetup: "./e2e/serve.mjs",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});

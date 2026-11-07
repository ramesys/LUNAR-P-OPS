import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the isolated Docker stack (`make e2e-up`), with read-only scientific data.
 * They drive an installed browser (no browser download): Microsoft Edge by default, or another
 * Playwright channel via E2E_CHANNEL, e.g. `E2E_CHANNEL=chrome` where Edge is not installed.
 */
const channel: string = process.env["E2E_CHANNEL"] ?? "msedge";
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:15180",
    channel,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Edge"], channel },
      grepInvert: /@phone|@screenshots/,
    },
    {
      name: "phone",
      use: { channel, viewport: { width: 390, height: 844 }, isMobile: false },
      grep: /@phone/,
    },
    {
      name: "screenshots",
      use: { channel, colorScheme: "light", deviceScaleFactor: 1 },
      grep: /@screenshots/,
    },
  ],
});

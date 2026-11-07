import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the running Docker stack (`docker compose up`), with real data.
 * They drive an installed browser (no browser download): Microsoft Edge by default, or another
 * Playwright channel via E2E_CHANNEL, e.g. `E2E_CHANNEL=chrome` where Edge is not installed.
 */
const channel: string = process.env["E2E_CHANNEL"] ?? "msedge";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:5180",
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

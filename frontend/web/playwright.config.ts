import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the running Docker stack (`docker compose up`), with real data.
 * They drive the Microsoft Edge already installed on Windows (no browser download).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:5180",
    channel: "msedge",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Edge"], channel: "msedge" },
      grepInvert: /@phone|@screenshots/,
    },
    {
      name: "phone",
      use: { channel: "msedge", viewport: { width: 390, height: 844 }, isMobile: false },
      grep: /@phone/,
    },
    {
      name: "screenshots",
      use: { channel: "msedge", colorScheme: "light", deviceScaleFactor: 1 },
      grep: /@screenshots/,
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // A failed live reconciliation is not retried automatically because it creates a persistent audit record.
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 780_000,
  expect: { timeout: 15_000 },
  use: { ...devices["Desktop Chrome"], headless: true, trace: "retain-on-failure" },
});

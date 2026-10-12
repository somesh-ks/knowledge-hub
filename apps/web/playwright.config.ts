import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 4321);

/**
 * The suite builds the site with the invented fixture digests (DISPATCH_FIXTURES=1), serves the
 * output with a static server that applies vercel.json's headers, and drives it in Chromium at a
 * phone and a desktop size. Run `npx playwright install chromium` once.
 *
 * Each test runs in one project. Untagged tests run on the phone. A test that needs a mouse, the
 * keyboard, the side column or the pinned form is tagged `@desktop` and runs on the desktop only.
 * A sweep that must hold at both sizes is tagged `@both`.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    // Narration needs no tap in a test browser, so a started audio file plays at once.
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [
    {
      name: "phone",
      grepInvert: /@desktop/,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "desktop",
      grep: /@desktop|@both/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "node e2e/run.mjs",
    url: `http://127.0.0.1:${PORT}/offline`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { PORT: String(PORT) },
  },
});

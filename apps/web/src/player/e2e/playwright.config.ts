import { defineConfig } from "@playwright/test";

/**
 * Component-level checks of the player and the sheets against the dev lab, in a real Chromium with
 * a real audio element. Run with:
 *   npx playwright test -c apps/web/src/player/e2e/playwright.config.ts
 * Set PLAYER_LAB_URL to reuse a dev server that is already running.
 */
const baseURL = process.env.PLAYER_LAB_URL ?? "http://127.0.0.1:4400";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    colorScheme: "light",
  },
  webServer: {
    command: "npm run dev -w @dispatch/web -- --port 4400 --host 127.0.0.1",
    url: `${baseURL}/dev/player-lab`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

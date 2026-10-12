import { defineConfig, devices } from "@playwright/test";

/**
 * The player suite, on real digest pages from the fixture build (DISPATCH_FIXTURES=1), served by
 * the static server the site suite uses. Run with:
 *   npx playwright test -c apps/web/src/player/e2e/playwright.config.ts
 *
 * Every test runs on a phone (390x844, touch, Chromium) unless it is tagged @wide. Tests tagged
 * @desktop or @wide also run at 1280x800 with a mouse: the ones that need a mouse or a wide
 * window. Tests that need another window size set it inside the test, once.
 *
 * PLAYER_WEBKIT=1 adds an iPhone in WebKit for the @smoke tests, all taps. It is opt-in because
 * WebKit is not installed everywhere the suite runs.
 *
 * The port comes from the environment so two checkouts can run side by side: PORT (default 4321,
 * shared with the site suite). Set PLAYER_SITE_URL to reuse a server that is already running.
 */
const SITE_PORT = Number(process.env.PORT ?? 4321);
const siteURL = process.env.PLAYER_SITE_URL ?? `http://127.0.0.1:${SITE_PORT}`;

const phone = {
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
};
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } };

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  // The flicks state each touch event's time (helpers.ts) and run on Chromium touch only, so a busy
  // machine no longer turns them into slow drags: nothing here needs a retry to pass.
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../../test-results/player",
  use: { colorScheme: "light", baseURL: siteURL },
  projects: [
    { name: "site-phone", grepInvert: /@wide/, use: phone },
    { name: "site-desktop", grep: /@desktop|@wide/, use: desktop },
    ...(process.env.PLAYER_WEBKIT
      ? [{ name: "site-webkit-iphone", grep: /@smoke/, use: { ...devices["iPhone 14"] } }]
      : []),
  ],
  webServer: {
    command: "node e2e/run.mjs",
    cwd: "../../..",
    url: `${siteURL}/offline`,
    reuseExistingServer: true,
    timeout: 240_000,
    env: { PORT: String(SITE_PORT) },
  },
});

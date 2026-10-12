import { defineConfig, devices } from "@playwright/test";

/**
 * The player suite, on real digest pages from the fixture build (DISPATCH_FIXTURES=1), served by
 * the static server the site suite uses. Every spec runs on a phone in Chromium; the specs tagged
 * @surface also run at a short phone height, on a desktop with a mouse, and in WebKit at an iPhone
 * and an iPad size. Run with:
 *   npx playwright test -c apps/web/src/player/e2e/playwright.config.ts
 *
 * The port comes from the environment so two checkouts can run side by side: PORT (default 4321,
 * shared with the site suite). Set PLAYER_SITE_URL to reuse a server that is already running.
 */
const SITE_PORT = Number(process.env.PORT ?? 4321);
const siteURL = process.env.PLAYER_SITE_URL ?? `http://127.0.0.1:${SITE_PORT}`;

const SURFACE = /@surface/;

const phone = { deviceScaleFactor: 2, hasTouch: true, isMobile: true } as const;
const tall = { ...phone, viewport: { width: 390, height: 844 } };
const short = { ...phone, viewport: { width: 390, height: 664 } };
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } };
const iphone = { ...devices["iPhone 14"] };
const ipad = { ...devices["iPad (gen 7)"], viewport: { width: 820, height: 1180 } };

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  // One retry: a flick is synthesized as touch events 8 ms apart, and its speed is real time. A
  // busy machine stretches the gaps until it is no longer a flick. A pass on retry reports as flaky.
  retries: 1,
  reporter: [["list"]],
  outputDir: "../../../test-results/player",
  use: { colorScheme: "light", baseURL: siteURL },
  projects: [
    { name: "site-phone", use: tall },
    { name: "site-phone-short", grep: SURFACE, use: short },
    { name: "site-desktop", grep: SURFACE, use: desktop },
    { name: "site-webkit-iphone", grep: SURFACE, use: iphone },
    { name: "site-webkit-ipad", grep: SURFACE, use: ipad },
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

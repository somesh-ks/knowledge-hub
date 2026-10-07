import { defineConfig, devices } from "@playwright/test";
import type { PlayerOptions } from "./lab";

/**
 * The player suite. It drives the same specs against two targets:
 *
 * - "lab": the dev lab page, served by `astro dev`. Every spec runs here on a phone in Chromium.
 * - "site": a real digest page from the fixture build (DISPATCH_FIXTURES=1), served by the static
 *   server the site suite uses.
 *
 * The specs tagged @surface are the ones that hold on any page that mounts the player. They run on
 * both targets at two phone heights, on a desktop with a mouse, and in WebKit at an iPhone and an
 * iPad size. Run with:
 *   npx playwright test -c apps/web/src/player/e2e/playwright.config.ts
 *
 * Ports come from the environment so two checkouts can run side by side:
 *   PLAYER_LAB_PORT (default 4400) and PORT (default 4321, shared with the site suite).
 * Set PLAYER_LAB_URL or PLAYER_SITE_URL to reuse a server that is already running elsewhere.
 */
const LAB_PORT = Number(process.env.PLAYER_LAB_PORT ?? 4400);
const SITE_PORT = Number(process.env.PORT ?? 4321);
const labURL = process.env.PLAYER_LAB_URL ?? `http://127.0.0.1:${LAB_PORT}`;
const siteURL = process.env.PLAYER_SITE_URL ?? `http://127.0.0.1:${SITE_PORT}`;

const SURFACE = /@surface/;

const phone = { deviceScaleFactor: 2, hasTouch: true, isMobile: true } as const;
const tall = { ...phone, viewport: { width: 390, height: 844 } };
const short = { ...phone, viewport: { width: 390, height: 664 } };
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } };
const iphone = { ...devices["iPhone 14"] };
const ipad = { ...devices["iPad (gen 7)"], viewport: { width: 820, height: 1180 } };

function targetProjects(target: PlayerOptions["target"], baseURL: string) {
  const use = { baseURL, target };
  return [
    { name: `${target}-phone-short`, grep: SURFACE, use: { ...use, ...short } },
    { name: `${target}-desktop`, grep: SURFACE, use: { ...use, ...desktop } },
    { name: `${target}-webkit-iphone`, grep: SURFACE, use: { ...use, ...iphone } },
    { name: `${target}-webkit-ipad`, grep: SURFACE, use: { ...use, ...ipad } },
  ];
}

export default defineConfig<PlayerOptions>({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "../../../test-results/player",
  use: { colorScheme: "light" },
  projects: [
    // The whole suite, on the lab, at the size it was written for.
    { name: "lab-phone", use: { baseURL: labURL, target: "lab", ...tall } },
    ...targetProjects("lab", labURL),
    { name: "site-phone", grep: SURFACE, use: { baseURL: siteURL, target: "site", ...tall } },
    ...targetProjects("site", siteURL),
  ],
  webServer: [
    {
      command: `npm run dev -w @dispatch/web -- --port ${LAB_PORT} --host 127.0.0.1`,
      url: `${labURL}/dev/player-lab`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "node e2e/run.mjs",
      cwd: "../../..",
      url: `${siteURL}/offline`,
      reuseExistingServer: true,
      timeout: 240_000,
      env: { PORT: String(SITE_PORT) },
    },
  ],
});

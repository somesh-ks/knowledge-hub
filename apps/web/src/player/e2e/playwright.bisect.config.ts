import { defineConfig, devices } from "@playwright/test";
import type { PlayerOptions } from "./lab";

// Local bisect config (untracked): the site projects only, against a server already running.
const siteURL = process.env.PLAYER_SITE_URL ?? "http://127.0.0.1:4790";
const phone = { deviceScaleFactor: 2, hasTouch: true, isMobile: true } as const;

export default defineConfig<PlayerOptions>({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"]],
  outputDir: "../../../test-results/player-bisect",
  use: { colorScheme: "light" },
  projects: [
    {
      name: "site-desktop",
      grep: /@surface/,
      use: {
        baseURL: siteURL,
        target: "site",
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "site-phone-short",
      grep: /@surface/,
      use: { baseURL: siteURL, target: "site", ...phone, viewport: { width: 390, height: 664 } },
    },
  ],
});

import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

declare global {
  interface Window {
    __heard: string[];
    __oscillators: number;
    __context: AudioContext | null;
  }
}

/**
 * The delegated interface cues on the real site: a navigation link, a Contents entry, a filter
 * chip and a switch each make exactly one cue of the right kind, and none once Sounds is off.
 * `singularity:cue` names the cue the delegate chose and the engine accepted; the oscillator count is
 * the independent check that audio was really produced.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__heard = [];
    window.__oscillators = 0;
    window.__context = null;
    document.addEventListener("singularity:cue", (event) => {
      window.__heard.push((event as CustomEvent<string>).detail);
    });
    const OriginalContext = window.AudioContext;
    window.AudioContext = class extends OriginalContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.__context = this;
        const createOscillator = this.createOscillator.bind(this);
        this.createOscillator = () => {
          window.__oscillators += 1;
          return createOscillator();
        };
      }
    } as typeof AudioContext;
  });
});

const heard = (page: Page) => page.evaluate(() => [...window.__heard]);
const oscillators = (page: Page) => page.evaluate(() => window.__oscillators);

/**
 * The first gesture creates and resumes the audio context; cues after it are heard. A click that
 * lands before the page's listener is installed starts nothing, so it is pressed again until the
 * context runs.
 */
async function prime(page: Page): Promise<void> {
  await expect(async () => {
    await page.mouse.click(2, 2);
    await expect
      .poll(() => page.evaluate(() => window.__context?.state), { timeout: 2000 })
      .toBe("running");
  }).toPass({ timeout: 10_000 });
  await page.evaluate(() => {
    window.__heard.length = 0;
    window.__oscillators = 0;
  });
}

const library = (page: Page) =>
  page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Library" });

test.describe("interface cues by kind of action", () => {
  const rows = [
    {
      name: "a navigation link ticks",
      path: "/d/2026-10-07",
      act: (page: Page) => library(page).click(),
      cue: /^scrubDetent$/,
    },
    {
      name: "a Contents entry ticks",
      path: "/d/2026-10-07",
      act: (page: Page) => page.locator("[data-section]:visible").nth(1).click(),
      cue: /^scrubDetent$/,
    },
    {
      name: "a toggle button is a select",
      path: "/library",
      act: (page: Page) => page.locator("[data-library-view='list']").click(),
      cue: /^toggleOn$/,
    },
  ];
  for (const row of rows) {
    test(`${row.name}, once`, async ({ player, page }) => {
      await player.open(row.path);
      await prime(page);
      await row.act(page);
      await expect.poll(() => heard(page)).toHaveLength(1);
      expect((await heard(page))[0]).toMatch(row.cue);
      expect(await oscillators(page)).toBeGreaterThan(0);
    });
  }

  // Escape and a press outside close a menu with no control to press; the cue must still sound.
  test("a menu opens with a cue, and Escape closes it with one", async ({ player, page }) => {
    await player.open("/");
    await prime(page);
    const more = page.getByRole("button", { name: "More actions" });
    await more.click();
    await expect.poll(() => heard(page)).toEqual(["sheetOpen"]);
    await page.keyboard.press("Escape");
    await expect.poll(() => heard(page)).toEqual(["sheetOpen", "sheetClose"]);
  });

  test("an action button taps once, and a menu action too", async ({ player, page }) => {
    // A Library row's menu: the briefing's own menu has only actions that open a panel since Share
    // moved beside Play (D153).
    await player.open("/library");
    await prime(page);
    await page
      .getByRole("button", { name: /^More actions for / })
      .first()
      .click();
    await expect.poll(() => heard(page)).toEqual(["sheetOpen"]);
    // The menu action is a plain button: a soft tap, never a select.
    await page.getByRole("menuitem", { name: "Share" }).click();
    await expect.poll(() => heard(page)).toHaveLength(2);
    expect((await heard(page))[1]).toBe("scrubDetent");
  });

  test("the Settings switch plays its own cue, not doubled; once off nothing sounds", async ({
    player,
    page,
  }) => {
    await player.open("/settings/sounds");
    await prime(page);
    const sounds = page.getByRole("switch", { name: "Interface sounds", exact: true });
    await sounds.click();
    await expect(sounds).not.toBeChecked();
    // The switch sounds its own cue on the way off; the delegate stays out of its way.
    await expect.poll(() => oscillators(page)).toBeGreaterThan(0);
    expect(await heard(page)).toEqual([]);
    await page.evaluate(() => {
      window.__oscillators = 0;
    });
    await library(page).click();
    await expect(page).toHaveURL(/\/library$/);
    await page.locator("[data-library-view='list']").click();
    await expect(page.locator("[data-library-view='list']")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await heard(page)).toEqual([]);
    expect(await oscillators(page)).toBe(0);
  });
});

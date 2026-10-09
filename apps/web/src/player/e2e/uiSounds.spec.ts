import type { Page } from "@playwright/test";
import { expect, test } from "./lab";

declare global {
  interface Window {
    __heard: string[];
    __oscillators: number[];
  }
}

/**
 * The delegated interface cues on the real site: a navigation link, a Contents entry, a filter
 * chip and a switch each make exactly one cue of the right kind, and none once Sounds is off.
 * `dispatch:cue` names the cue the delegate chose and the engine accepted; the oscillator log is
 * the independent check that audio was really produced, once per cue.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__heard = [];
    window.__oscillators = [];
    document.addEventListener("dispatch:cue", (event) => {
      window.__heard.push((event as CustomEvent<string>).detail);
    });
    const OriginalContext = window.AudioContext;
    window.AudioContext = class extends OriginalContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        const createOscillator = this.createOscillator.bind(this);
        this.createOscillator = () => {
          window.__oscillators.push(performance.now());
          return createOscillator();
        };
      }
    } as typeof AudioContext;
  });
});

const heard = (page: Page) => page.evaluate(() => [...window.__heard]);

/** Oscillators created within a few milliseconds of each other are one cue's layers. */
const sounded = (page: Page) =>
  page.evaluate(() => {
    let count = 0;
    let last = Number.NEGATIVE_INFINITY;
    for (const at of window.__oscillators) {
      if (at - last > 30) count += 1;
      last = at;
    }
    return count;
  });

async function reset(page: Page): Promise<void> {
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__heard.length = 0;
    window.__oscillators.length = 0;
  });
}

/** The first gesture creates and resumes the audio context; cues after it are heard. */
async function prime(page: Page): Promise<void> {
  await page.mouse.click(2, 2);
  await page.waitForTimeout(500);
  await reset(page);
}

test.describe("interface cues by kind of action @surface", () => {
  test.skip(({ target }) => target !== "site", "needs the site's navigation and pages");

  test("a navigation link ticks once", async ({ lab, page }) => {
    await lab.open();
    await prime(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library" })
      .click();
    await expect(page).toHaveURL(/\/library$/);
    await page.waitForTimeout(300);
    expect(await heard(page)).toEqual(["scrubDetent"]);
    expect(await sounded(page)).toBe(1);
  });

  test("a Contents entry ticks once", async ({ lab, page }) => {
    await lab.open();
    await prime(page);
    const entry = page.locator("[data-section]:visible").nth(1);
    await entry.click();
    await page.waitForTimeout(300);
    expect(await heard(page)).toEqual(["scrubDetent"]);
    expect(await sounded(page)).toBe(1);
  });

  test("a filter chip is a select", async ({ lab, page }) => {
    await lab.open("/library");
    await prime(page);
    const chip = page.locator("[data-library-filter]").nth(1);
    await chip.click();
    await page.waitForTimeout(250);
    expect(await heard(page)).toEqual(["toggleOn"]);
    expect(await sounded(page)).toBe(1);
  });

  test("a switch is a select, and its own cue is not doubled", async ({ lab, page }) => {
    await lab.open("/settings/podcast/topics");
    await prime(page);
    const topic = page.getByRole("switch").first();
    await topic.click();
    await page.waitForTimeout(300);
    const kinds = await heard(page);
    expect(kinds).toHaveLength(1);
    expect(["toggleOn", "toggleOff"]).toContain(kinds[0]);
    expect(await sounded(page)).toBe(1);

    await lab.open("/settings");
    await prime(page);
    await page.getByRole("switch", { name: "Interface sounds" }).click();
    await page.waitForTimeout(300);
    // The Settings switch plays its own cue; the delegate stays out of its way.
    expect(await heard(page)).toEqual([]);
    expect(await sounded(page)).toBe(1);
  });

  test("nothing sounds once Sounds is off", async ({ lab, page }) => {
    await lab.open("/settings");
    await prime(page);
    await page.getByRole("switch", { name: "Interface sounds" }).click();
    await expect(page.getByRole("switch", { name: "Interface sounds" })).not.toBeChecked();
    await reset(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library" })
      .click();
    await expect(page).toHaveURL(/\/library$/);
    await page.locator("[data-library-filter]").nth(1).click();
    await page.waitForTimeout(400);
    expect(await heard(page)).toEqual([]);
    expect(await sounded(page)).toBe(0);
  });
});

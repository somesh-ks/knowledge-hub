import type { Page } from "@playwright/test";
import { expect, hydrated, SILENT_DIGEST, test } from "./fixtures";

/**
 * Behaviour that makes the phone layout feel like a native app: one floating button where its action
 * is the next thing to do (Create on the Library, Play on Today, a briefing or an episode), and the
 * tab bar's press on the current tab.
 */

/** Both floating buttons take their shape from .create-fab; Play adds .play-fab. */
const createFab = (page: Page) => page.locator(".create-fab:not(.play-fab)");
const playFab = (page: Page) => page.locator(".play-fab");

/** Scrolls the hero's Play chip out of view, where the floating Play comes in (create-sheet.css). */
async function pastHero(page: Page): Promise<void> {
  await page.evaluate(() => {
    const actions = document.querySelector(".hero-actions");
    window.scrollTo({
      top: (actions?.getBoundingClientRect().bottom ?? 0) + 200,
      behavior: "instant",
    });
  });
}

/** Narration as the server answers it when every file already exists (reader.spec.ts). */
async function serveNarration(page: Page): Promise<void> {
  const ids = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.items as { id: string }[]).map((item) => item.id);
  });
  await page.route("**/api/narrate?digest=*", (route) =>
    route.fulfill({
      json: {
        status: 200,
        audio: null,
        timeline: null,
        ms_per_character: 62,
        segments: ["intro", ...ids].map((key) => ({
          key,
          item_id: key === "intro" ? null : key,
          characters: 300,
          audio: { url: "/fixtures/audio.wav", duration_ms: 18_600, confirmed: false },
        })),
      },
    }),
  );
  await page.route("**/api/narrate", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment } = route.request().postDataJSON() as { segment: string };
    return route.fulfill({
      json: {
        status: 200,
        segment: {
          key: segment,
          item_id: segment === "intro" ? null : segment,
          characters: 300,
          audio: { url: "/fixtures/audio.wav", duration_ms: 18_600, confirmed: true },
        },
      },
    });
  });
}

test.describe("the floating button", () => {
  test("is Create on the Library, Play on Today, a briefing or an episode, Add on Topics and sources, and absent elsewhere", async ({
    page,
  }) => {
    // Short enough that even an episode's page scrolls its hero's Play out of view.
    await page.setViewportSize({ width: 390, height: 560 });
    await page.goto("/library");
    await expect(createFab(page)).toBeVisible();
    await expect(playFab(page)).toHaveCount(0);
    // Today and the latest briefing at its dated address, which the navigation marks as Today, play
    // like any other briefing.
    for (const [path, noun] of [
      ["/", "briefing"],
      ["/d/2026-10-07", "briefing"],
      ["/d/2026-10-05", "briefing"],
      ["/d/2026-10-04-weekly", "briefing"],
      ["/e/ep-20261007-1930", "episode"],
    ] as const) {
      await page.goto(path);
      // While the hero's own Play is on screen the floating one waits, and comes in past it.
      await expect(playFab(page), path).toBeHidden();
      await pastHero(page);
      await expect(playFab(page), path).toBeVisible();
      // It says what the hero chip says: its name, and its words after the verb.
      const length = await page.locator(".hero [data-chip-label]").textContent();
      await expect(playFab(page), path).toHaveAccessibleName(`Play the ${noun}, ${length}`);
      await expect(playFab(page), path).toContainText(`Play · ${length}`);
      await expect(createFab(page), path).toHaveCount(0);
      await expect(page.locator("html"), path).toHaveAttribute("data-fab", "");
    }
    for (const path of ["/settings", "/settings/daily", "/create"]) {
      await page.goto(path);
      await expect(page.locator(".create-fab"), path).toHaveCount(0);
    }
    await page.goto("/settings/topics");
    await expect(page.locator(".create-fab")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("data-fab", "");
  });

  test("Play waits while the hero's Play is on screen, and comes and goes with it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 560 });
    for (const path of ["/", "/e/ep-20261007-1930"]) {
      await page.goto(path);
      const root = page.locator("html");
      await expect(playFab(page), path).toBeHidden();
      await expect(root, path).not.toHaveAttribute("data-hero-away");
      await pastHero(page);
      await expect(root, path).toHaveAttribute("data-hero-away", "");
      await expect(playFab(page), path).toBeVisible();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await expect(playFab(page), path).toBeHidden();
    }
    // A page with no hero keeps its button: Create on the Library.
    await page.goto("/library");
    await expect(page.locator("html")).not.toHaveAttribute("data-hero-away");
    await expect(createFab(page)).toBeVisible();
  });

  test("at the end of a briefing the last line stays clear of Play", async ({ page }) => {
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ["/", "/d/2026-10-07"]) {
        await page.goto(path);
        await page.evaluate(() =>
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
        );
        await expect(playFab(page)).toBeVisible();
        // Once the page has settled at its end (the shelf may still be laying out).
        await page.waitForTimeout(400);
        await page.evaluate(() =>
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
        );
        const fab = await playFab(page).boundingBox();
        const last = await page.locator(".earlier .card-facts").last().boundingBox();
        expect((last?.y ?? 0) + (last?.height ?? 0), `${path} at ${width}`).toBeLessThanOrEqual(
          fab?.y ?? 0,
        );
      }
    }
  });

  test("Play is extended at the top and folds while scrolling down to read", async ({ page }) => {
    await page.goto(SILENT_DIGEST);
    const play = playFab(page);
    expect(Math.round((await play.boundingBox())?.width ?? 0)).toBeGreaterThan(56);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    await page.mouse.wheel(0, 600);
    await expect(play).toHaveAttribute("data-folded", "");
    await expect.poll(async () => Math.round((await play.boundingBox())?.width ?? 0)).toBe(56);
    await page.mouse.wheel(0, -400);
    await expect(play).not.toHaveAttribute("data-folded", "");
  });

  test("Play plays the page's audio as the hero chip does, and steps aside while the bar holds it", async ({
    page,
  }) => {
    await page.goto(SILENT_DIGEST);
    await hydrated(page);
    await serveNarration(page);
    const root = page.locator("html");
    await pastHero(page);
    await playFab(page).click();
    await expect(root).toHaveAttribute("data-player-state", "playing");
    await expect(page.locator(".hero [data-play-digest]")).toHaveAttribute("data-state", "current");
    // One play control at a time: the bar is the page's control now, and the page gives back the
    // room it kept for the button.
    await expect(root).toHaveAttribute("data-mini", "visible");
    await expect(root).not.toHaveAttribute("data-fab");
    await expect(playFab(page)).toBeHidden();
    // The player writes the chip's face on it, its name too.
    await expect(playFab(page)).toHaveAttribute("aria-label", /^Pause the briefing, \d+ min left$/);

    // On a page whose audio the bar does not hold, Play is back, above the bar and clear of it.
    await page.locator('a[href="/d/2026-10-04-weekly"]').first().click();
    await expect(page).toHaveURL(/\/d\/2026-10-04-weekly$/);
    await expect(root).toHaveAttribute("data-player-state", "playing");
    await pastHero(page);
    await expect(playFab(page)).toBeVisible();
    await page.waitForTimeout(500);
    const fab = await playFab(page).boundingBox();
    const controls = await page
      .locator(".player-dock button")
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.getBoundingClientRect())
          .map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })),
      );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const apart =
        (fab?.y ?? 0) + (fab?.height ?? 0) <= control.top ||
        (fab?.x ?? 0) + (fab?.width ?? 0) <= control.left ||
        (fab?.x ?? 0) >= control.right ||
        (fab?.y ?? 0) >= control.bottom;
      expect(apart).toBe(true);
    }

    // Back on the page that is playing, the button is not there from the first frame.
    await page.goBack();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await expect(root).not.toHaveAttribute("data-fab");
    await expect(playFab(page)).toBeHidden();
  });

  test("the side column keeps New episode on every page, and no floating button shows", {
    tag: "@desktop",
  }, async ({ page }) => {
    for (const path of ["/", "/settings/daily", "/d/2026-10-05", "/e/ep-20261007-1930"]) {
      await page.goto(path);
      await expect(page.locator(".app-nav-create"), path).toBeVisible();
      await expect(page.locator(".create-fab"), path).toBeHidden();
    }
  });

  test("on the Create page, New episode is the current place: it goes to the top and keeps what is typed", {
    tag: "@desktop",
  }, async ({ page }) => {
    // Short enough that the whole form does not fit, so there is somewhere to scroll.
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto("/create");
    await expect(page.locator("main [data-create]")).toHaveAttribute("data-ready", "");
    const title = page.getByRole("textbox", { name: /^Title/ });
    await title.fill("My week in AI");
    await page.evaluate(() => {
      (window as unknown as { kept?: boolean }).kept = true;
      window.scrollTo(0, 400);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const button = page.locator(".app-nav-create");
    // Marked as the place you are on, as the current tab is, so the press is not a silent no-op.
    await expect(button).toHaveAttribute("aria-current", "page");
    await button.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page).toHaveURL(/\/create$/);
    // No silent focus move into the form: the focus stays on the button that was pressed.
    await expect(button).toBeFocused();
    await expect(title).toHaveValue("My week in AI");
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  });
});

test.describe("the tab bar", () => {
  test("pressing the destination you are on takes you to its top, without loading it again", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
    // A mark on the window: a new page load would drop it.
    await page.evaluate(() => {
      (window as unknown as { kept?: boolean }).kept = true;
    });
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Latest", exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  });

  test("on the latest briefing's dated page, Today goes to its top, as on Today itself", async ({
    page,
  }) => {
    await page.goto("/d/2026-10-07");
    const today = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Latest", exact: true });
    await expect(today).toHaveAttribute("aria-current", "page");
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
    await today.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page).toHaveURL(/\/d\/2026-10-07$/);
  });
});

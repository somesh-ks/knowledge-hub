import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * A move between destinations must not wait: for the network when a saved copy is recent, for an
 * exit animation, for pictures of the page, or for the new page before the navigation shows where
 * the press went. These check the mechanisms, read inside the page at the event itself, so neither
 * the clock nor a busy machine can fail them.
 */

async function savedPages(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.includes("-pages-")) continue;
      for (const request of await (await caches.open(name)).keys()) {
        paths.push(new URL(request.url).pathname);
      }
    }
    return paths;
  });
}

interface Move {
  /** The page as the press left it, before its replacement was fetched. */
  onPress: { swapMark: string | null; leaving: string[]; current: string | null };
  /** What drew the swap, read in the same task as the swap. */
  atSwap: {
    browserTransition: boolean;
    swapMark: string | null;
    names: string[];
    longest: number;
  } | null;
}

/**
 * Opens Today, waits until the worker is in control and the other destinations are saved (which
 * also means the idle-time module is installed), then records every move from here on.
 */
async function openWarm(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect
    .poll(() => savedPages(page))
    .toEqual(expect.arrayContaining(["/library", "/settings"]));
  await page.evaluate(() => {
    const moves: Move[] = [];
    (window as unknown as { __moves: Move[] }).__moves = moves;
    const onShell = () =>
      (document.getAnimations() as CSSAnimation[]).filter((animation) =>
        (animation.effect as KeyframeEffect | null)?.target?.matches(".shell"),
      );
    const mark = () => document.documentElement.getAttribute("data-nav-swap");
    // Registered after the app's own listeners, so each runs once they have done their part.
    document.addEventListener("astro:before-preparation", () => {
      moves.push({
        onPress: {
          swapMark: mark(),
          leaving: onShell().map((animation) => animation.animationName),
          current:
            document.querySelector('.app-nav-item[aria-current="page"]')?.getAttribute("href") ??
            null,
        },
        atSwap: null,
      });
    });
    let browserTransition = false;
    document.addEventListener("astro:before-swap", (event) => {
      browserTransition = event.viewTransition instanceof ViewTransition;
    });
    document.addEventListener("astro:after-swap", () => {
      const move = moves.at(-1);
      if (!move) return;
      const running = onShell();
      move.atSwap = {
        browserTransition,
        swapMark: mark(),
        names: running.map((animation) => animation.animationName),
        longest: Math.max(
          0,
          ...running.map((animation) => Number(animation.effect?.getComputedTiming().endTime ?? 0)),
        ),
      };
    });
  });
}

const lastMove = (page: Page): Promise<Move | undefined> =>
  page.evaluate(() => (window as unknown as { __moves: Move[] }).__moves.at(-1));

const item = (page: Page, href: string) => page.locator(`.app-nav-item[href="${href}"]`);
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test.describe("moving between destinations", () => {
  test("the other destinations are saved soon after the app opens", async ({ page }) => {
    await openWarm(page);
    // A saved page carries the time it was saved; that is what lets the worker answer at once.
    const stamp = await page.evaluate(async () => {
      const response = await fetch("/library", { headers: { accept: "text/html" } });
      return response.headers.get("x-singularity-stored-at");
    });
    expect(Number(stamp)).toBeGreaterThan(0);
  });

  test("a page load still asks the network", async ({ page }) => {
    await openWarm(page);
    const response = await page.goto("/library");
    expect(response?.headers()["x-singularity-stored-at"]).toBeUndefined();
    await expect(heading(page)).toHaveText("Library");
  });

  test("the pressed destination lights up before its page arrives", async ({ page }) => {
    await openWarm(page);
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    expect((await lastMove(page))?.onPress.current).toBe("/library");
    await expect(page.locator('.app-nav-item[aria-current="page"]')).toHaveCount(1);
  });

  test("the move takes no pictures of the page, has no exit, and is over in the time of a press", async ({
    page,
  }) => {
    await openWarm(page);
    await item(page, "/settings").click();
    await expect(heading(page)).toHaveText("Settings");
    const move = await lastMove(page);
    expect(move?.atSwap?.browserTransition).toBe(false);
    expect(move?.atSwap?.longest).toBeLessThanOrEqual(150);
  });
});

test.describe("the chrome holds still on a move", () => {
  // The player rides through a move as the same element, which starts every CSS animation on it
  // again: the dock's caption and the story line faded in anew on each move (owner, 2026-10-31).
  test("a move does not start the playing bar's animations again", async ({ page }) => {
    await openWarm(page);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator(".player-dock .dock-caption")).toContainText("/");
    await page.evaluate(() => {
      const w = window as unknown as { __animations: { before: string[]; after: string[] } };
      const running = (): string[] =>
        (document.getAnimations() as CSSAnimation[])
          .filter((animation) => {
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return (
              target?.closest("[data-astro-transition-persist]") &&
              animation.playState === "running" &&
              Number.isFinite(animation.effect?.getComputedTiming().endTime)
            );
          })
          .map((animation) => animation.animationName);
      w.__animations = { before: [], after: [] };
      document.addEventListener("astro:before-swap", () => {
        w.__animations.before = running();
      });
      document.addEventListener("astro:after-swap", () => {
        w.__animations.after = running();
      });
    });
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    const { before, after } = await page.evaluate(
      () =>
        (window as unknown as { __animations: { before: string[]; after: string[] } }).__animations,
    );
    // One still fading in as the move began may carry on; none may begin that was not running.
    for (const name of after) expect(before).toContain(name);
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  // A cached page arrives a few tens of milliseconds after the press, while the pill is growing under
  // the pressed tab. The new bar drew it whole: it jumped from a quarter grown to done.
  test("the pill is no further along on the new bar than on the one it replaces", async ({
    page,
  }) => {
    await openWarm(page);
    await page.evaluate(() => {
      const w = window as unknown as { __pill: { before: number; after: number } };
      const opacity = () => {
        const pill = document.querySelector(
          '.app-nav-item[aria-current="page"] .app-nav-indicator',
        );
        return pill ? Number(getComputedStyle(pill, "::before").opacity) : Number.NaN;
      };
      w.__pill = { before: Number.NaN, after: Number.NaN };
      document.addEventListener("astro:before-swap", () => {
        w.__pill.before = opacity();
      });
      document.addEventListener("astro:after-swap", () => {
        w.__pill.after = opacity();
      });
    });
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    const { before, after } = await page.evaluate(
      () => (window as unknown as { __pill: { before: number; after: number } }).__pill,
    );
    expect(Math.abs(after - before)).toBeLessThan(0.3);
  });
});

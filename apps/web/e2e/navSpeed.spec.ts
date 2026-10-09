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
      return response.headers.get("x-dispatch-stored-at");
    });
    expect(Number(stamp)).toBeGreaterThan(0);
  });

  test("a page load still asks the network", async ({ page }) => {
    await openWarm(page);
    const response = await page.goto("/library");
    expect(response?.headers()["x-dispatch-stored-at"]).toBeUndefined();
    await expect(heading(page)).toHaveText("Library");
  });

  test("the pressed destination lights up before its page arrives", async ({ page }) => {
    await openWarm(page);
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    expect((await lastMove(page))?.onPress.current).toBe("/library");
    await expect(page.locator('.app-nav-item[aria-current="page"]')).toHaveCount(1);
  });

  test("each destination shows one icon, the filled one only when current", async ({ page }) => {
    await page.goto("/settings");
    for (const href of ["/", "/library", "/settings"]) {
      await expect(item(page, href).locator("svg:visible")).toHaveCount(1);
    }
    await expect(item(page, "/settings").locator(".app-nav-icon-current")).toBeVisible();
    await expect(item(page, "/library").locator(".app-nav-icon-current")).toBeHidden();
  });

  test("the page that is leaving holds still: nothing on it fades or blinks on the press", async ({
    page,
  }) => {
    await openWarm(page);
    await item(page, "/settings").click();
    await expect(heading(page)).toHaveText("Settings");
    const move = await lastMove(page);
    expect(move?.onPress.swapMark).toBeNull();
    expect(move?.onPress.leaving).toEqual([]);
  });

  test("the move takes no pictures of the page, has no exit, and is over in the time of a press", async ({
    page,
  }) => {
    await openWarm(page);
    await item(page, "/settings").click();
    await expect(heading(page)).toHaveText("Settings");
    const move = await lastMove(page);
    expect(move?.atSwap?.browserTransition).toBe(false);
    expect(move?.atSwap?.swapMark).toBe("peer");
    expect(move?.atSwap?.names).toEqual(["fade-in"]);
    expect(move?.atSwap?.longest).toBeGreaterThan(0);
    expect(move?.atSwap?.longest).toBeLessThanOrEqual(150);
    // The marks come off once the fade has ended, and the browser's own transitions work again.
    await expect(page.locator("html")).not.toHaveAttribute("data-nav-swap");
    await expect(page.locator("html")).not.toHaveAttribute("data-astro-nav");
    expect(await page.evaluate(() => Object.hasOwn(document, "startViewTransition"))).toBe(false);
  });

  test("into a briefing the page settles from the side, and back out again", async ({ page }) => {
    await openWarm(page);
    // A page keeps the marks of its own arrival for a moment. Each press below waits for them to
    // come off first, so what it reads on the press is the press's doing and nothing else's.
    const settled = () => expect(page.locator("html")).not.toHaveAttribute("data-nav-swap");
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    await settled();

    await page.locator("a.card-link").first().click();
    await expect(page).toHaveURL(/\/(d|e)\//);
    const into = await lastMove(page);
    expect(into?.onPress.swapMark).toBeNull();
    expect(into?.onPress.leaving).toEqual([]);
    expect(into?.atSwap?.swapMark).toBe("in");
    expect(into?.atSwap?.names).toEqual(["fade-in", "page-from-end"]);
    expect(into?.atSwap?.longest).toBeLessThanOrEqual(150);
    await settled();

    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    const out = await lastMove(page);
    expect(out?.onPress.leaving).toEqual([]);
    expect(out?.atSwap?.swapMark).toBe("out");
    expect(out?.atSwap?.names).toEqual(["fade-in", "page-from-start"]);
  });

  test("after a move the browser's own startViewTransition is back in place", async ({ page }) => {
    await openWarm(page);
    await item(page, "/settings").click();
    await expect(heading(page)).toHaveText("Settings");
    // The stand-in served the router once and is gone: this is the real method again.
    const real = await page.evaluate(
      () => document.startViewTransition === Document.prototype.startViewTransition,
    );
    expect(real).toBe(true);
  });
});

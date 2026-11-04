import type { Page } from "@playwright/test";
import { closePlayer, expect, test } from "./fixtures";

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

  test("the move takes no pictures of the page, has no exit, and is over in a quarter second", async ({
    page,
  }) => {
    await openWarm(page);
    await item(page, "/settings").click();
    await expect(heading(page)).toHaveText("Settings");
    const move = await lastMove(page);
    expect(move?.atSwap?.browserTransition).toBe(false);
    expect(move?.atSwap?.longest).toBeLessThanOrEqual(250);
  });
});

test.describe("the chrome holds still on a move", () => {
  // The player rides through a move as the same element, which starts every CSS animation on it
  // again: the dock's caption and the story line faded in anew on each move (owner, 2026-10-31).
  test("a move does not start the playing bar's animations again", async ({ page }) => {
    await openWarm(page);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator(".player-dock .dock-caption")).toContainText("/");
    await closePlayer(page);
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

  // The swap takes tens of milliseconds (more on a phone). The new bar's pill began when the old one
  // did, not when the swap ended: counted from the swap, it went back by that long and grew again.
  test("a slow swap does not take the pill back", async ({ page }) => {
    await openWarm(page);
    await page.evaluate(() => {
      // The growth lasts seconds here, so a busy machine cannot let it run out before the swap: the
      // test is about where the new pill starts, not how long it lasts.
      // A constructed sheet, which the page's style policy allows and a swap leaves in place.
      const slow = new CSSStyleSheet();
      slow.replaceSync(
        'html[data-nav-arrived] .app-nav-item[aria-current="page"] .app-nav-indicator::before { animation-duration: 5s !important; }',
      );
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, slow];
      const w = window as unknown as { __pill: { before: number; after: number } };
      const started = (): number => {
        const pill = document.querySelector(
          '.app-nav-item[aria-current="page"] .app-nav-indicator',
        );
        const growth = pill
          ?.getAnimations({ subtree: true })
          .find((a) => a.playState === "running");
        // A pill not yet started is about to: from now.
        return growth ? Number(growth.startTime ?? document.timeline.currentTime) : Number.NaN;
      };
      w.__pill = { before: Number.NaN, after: Number.NaN };
      // The page takes a while to arrive, so the pill is drawn and growing when the swap begins.
      document.addEventListener("astro:before-preparation", (event) => {
        const load = event.loader;
        event.loader = async () => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          await load();
        };
      });
      document.addEventListener("astro:before-swap", () => {
        w.__pill.before = started();
        // A phone is slower than this machine: the swap takes this long.
        const until = performance.now() + 150;
        while (performance.now() < until);
      });
      document.addEventListener("astro:after-swap", () => {
        w.__pill.after = started();
      });
    });
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    const { before, after } = await page.evaluate(
      () => (window as unknown as { __pill: { before: number; after: number } }).__pill,
    );
    expect(before, "the pill was growing as the swap began").not.toBeNaN();
    expect(Math.abs(after - before)).toBeLessThan(2);
  });

  // Bug it prevents (owner, 2026-11-02): from a scrolled gallery, going back cut the saved offset short
  // (cards the page had not drawn counted as an estimate), so the page came back higher than it was
  // left and then moved. The card the owner opened is where it was, in the list and the gallery.
  for (const view of ["list", "gallery"]) {
    test(`going back the Library is where it was left, ${view}, and the card does not move after`, async ({
      page,
    }) => {
      await page.addInitScript((chosen) => {
        localStorage.setItem("singularity:library-view", chosen);
      }, view);
      await page.setViewportSize({ width: 390, height: 600 });
      await page.goto("/library");
      const card = page.locator("[data-card]").last();
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const cover = card.locator(".cover");
      const before = await cover.boundingBox();
      await card.locator(".card-link").click();
      await expect(page).toHaveURL(/\/d\//);
      await page.goBack();
      await expect(page).toHaveURL(/\/library$/);
      // The page drops into place for a quarter second (D347), and a box read on the way is that
      // many pixels short of where it ends (CI read 2.93, a value no layout gives). Measure once
      // the move is over: the page's mark is gone and nothing on the shell is still playing.
      await expect(cover).toBeVisible();
      await page.waitForFunction(
        () =>
          !document.documentElement.hasAttribute("data-nav-swap") &&
          !(document.getAnimations() as CSSAnimation[]).some((animation) =>
            (animation.effect as KeyframeEffect | null)?.target?.matches(".shell"),
          ),
      );
      const settled = await cover.boundingBox();
      expect(Math.abs((settled?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1.5);
      expect(Math.abs((settled?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(1.5);
      // And it stays: the page does not move again once it is back.
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))),
          ),
      );
      const after = await cover.boundingBox();
      expect(Math.abs((after?.y ?? 0) - (settled?.y ?? 0))).toBeLessThan(1.5);
    });
  }
});

test.describe("the whole bottom bar is the tab", () => {
  // Owner, 2026-10-31: the touch area was only the pill. A press anywhere in a tab's cell, and in the
  // strip the bar keeps above the home indicator (set here as the phone sets it), is that tab's press.
  test("a press under the label, at the cell's corner and in the home-indicator strip opens the tab", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => document.documentElement.style.setProperty("--safe-bottom", "34px"));
    const spots = [
      { href: "/library", at: [0.5, 0.97], heading: "Library" },
      { href: "/settings", at: [0.97, 0.03], heading: "Settings" },
    ] as const;
    for (const spot of spots) {
      const cell = await page.locator(`.app-nav-item[href="${spot.href}"]`).boundingBox();
      const bar = await page.locator(".app-nav").boundingBox();
      if (!cell || !bar) throw new Error("the bar is not on screen");
      // The strip is the bar's bottom padding: the link's box ends above it.
      const x = cell.x + cell.width * spot.at[0];
      const y = spot.at[1] > 0.9 ? bar.y + bar.height - 4 : cell.y + cell.height * spot.at[1];
      await page.touchscreen.tap(x, y);
      await expect(heading(page)).toHaveText(spot.heading);
      await page.goto("/");
      await page.evaluate(() =>
        document.documentElement.style.setProperty("--safe-bottom", "34px"),
      );
    }
  });

  // A phone on its side is wider than the 40rem column: the bar shows either side of the tabs, and
  // that bar belongs to the outer two.
  test("a press on the bar beside the column opens the outer tab", async ({ page }) => {
    await page.setViewportSize({ width: 880, height: 600 });
    await page.goto("/");
    const bar = await page.locator(".app-nav").boundingBox();
    if (!bar) throw new Error("the bar is not on screen");
    // The edge reach is the outer two tabs' alone: the middle one still takes its own cell.
    const middle = await page.locator('.app-nav-item[href="/library"]').boundingBox();
    if (!middle) throw new Error("the Library tab is not on screen");
    await page.touchscreen.tap(middle.x + middle.width / 2, bar.y + bar.height / 2);
    await expect(heading(page)).toHaveText("Library");
    await page.goto("/");
    await page.touchscreen.tap(bar.x + bar.width - 3, bar.y + bar.height / 2);
    await expect(heading(page)).toHaveText("Settings");
  });
});

test.describe("a touch on a tab shows at once and goes on across the move", () => {
  // Owner, 2026-11-01 (D286): the touch feedback was one instant frame, and a quick tap never showed
  // the pressed state at all (`:active` waits out the browser's press delay on a phone). The press
  // marks its tab from the first touch with a wave, and the wave belongs to the gesture: the bar a
  // move brings has it again, at the point it had reached, not restarted and not gone.
  test("a quick tap marks its tab on touch, and the wave is still going on the new page", async ({
    page,
  }) => {
    await openWarm(page);
    const tab = item(page, "/library");
    const box = await tab.boundingBox();
    if (!box) throw new Error("the Library tab is not on screen");
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);

    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await expect(tab).toHaveAttribute("data-ripple-pressed", "");
    // The wave is an animation on the document clock; the bar a move brings must carry on the same one.
    // A count of milliseconds played, taken before the swap and set again after it, runs behind by the
    // length of the swap (the wave plays on the compositor meanwhile) and the wave grows a second time
    // (owner, 2026-11-03: "double ripple" on a tap).
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .querySelector('.app-nav-item[href="/library"] .ripple-wave')
              ?.getAnimations()[0]?.startTime ?? null,
        ),
      )
      .not.toBeNull();
    await page.evaluate(() => {
      const wave = (): HTMLElement | null =>
        document.querySelector<HTMLElement>('.app-nav-item[href="/library"] .ripple-wave');
      const started = (): number => Number(wave()?.getAnimations()[0]?.startTime ?? Number.NaN);
      const origin = (): string => `${wave()?.style.left},${wave()?.style.top}`;
      const run = { before: started(), after: Number.NaN, from: origin(), to: "" };
      Object.assign(window, { rippleRun: run });
      document.addEventListener(
        "astro:after-swap",
        () => Object.assign(run, { after: started(), to: origin() }),
        { once: true },
      );
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(heading(page)).toHaveText("Library");

    const run = await page.evaluate(
      () =>
        (
          window as unknown as {
            rippleRun: { before: number; after: number; from: string; to: string };
          }
        ).rippleRun,
    );
    expect(run.after, "the new bar has no wave").not.toBeNaN();
    expect(run.after, "the wave started again on the new page").toBeCloseTo(run.before, 0);
    expect(run.to, "the wave moved to another origin").toBe(run.from);
  });

  // A second finger elsewhere, lifting, must not end the press the first one is making.
  test("another finger lifting does not end the press on the tab", async ({ page }) => {
    await page.goto("/");
    const tab = item(page, "/library");
    const box = await tab.boundingBox();
    if (!box) throw new Error("the Library tab is not on screen");
    const held = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
    const other = { x: 40, y: 300, id: 2 };
    const cdp = await page.context().newCDPSession(page);
    // The other finger's release must reach the page, or the check below proves nothing.
    await page.evaluate(() => {
      const ups: number[] = [];
      Object.assign(window, { pointerUps: ups });
      document.addEventListener("pointerup", (event) => ups.push(event.pointerId), true);
    });

    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [held] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [held, other] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [other] });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { pointerUps: number[] }).pointerUps))
      .toHaveLength(1);
    await expect(tab).toHaveAttribute("data-ripple-pressed", "");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [held] });
    await expect(tab).not.toHaveAttribute("data-ripple-pressed", "");
  });

  // Owner, 2026-11-03: "double ripples on all bottom nav tabs". A press drew the wave over the tab and,
  // in the same place, a grey pill under the icon: two concentric shapes. The wave is the press; the
  // pill is bare under a finger and grows once, when its page arrives.
  test("a touch on a tab draws one growing shape, and the pill under it comes in once", async ({
    page,
  }) => {
    await openWarm(page);
    const tab = item(page, "/library");
    const box = await tab.boundingBox();
    if (!box) throw new Error("the Library tab is not on screen");
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => {
      const seen = { opacity: [] as number[], greyUnderFinger: false, scaled: false };
      Object.assign(window, { pillSeen: seen });
      const watch = (): void => {
        const tab = document.querySelector('.app-nav-item[href="/library"]');
        const pill = tab?.querySelector(".app-nav-indicator");
        const drawn = pill ? getComputedStyle(pill, "::before") : null;
        if (drawn) {
          // Once the tab is the current one: before, its pill is bare and shows nothing at full opacity.
          if (tab?.getAttribute("aria-current") === "page") {
            seen.opacity.push(Number(drawn.opacity));
            // The wave is the growing shape: a pill that also scales up is a second circle opening.
            if (drawn.scale !== "none" && drawn.scale !== "1") seen.scaled = true;
          }
          // Still a bare tab (not yet the current one) with a tone on its pill is the second shape.
          if (
            tab?.hasAttribute("data-ripple-pressed") &&
            tab.getAttribute("aria-current") !== "page" &&
            drawn.backgroundColor !== "rgba(0, 0, 0, 0)"
          ) {
            seen.greyUnderFinger = true;
          }
        }
        requestAnimationFrame(watch);
      };
      watch();
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await expect(tab).toHaveAttribute("data-ripple-pressed", "");
    // Held until every transition and animation under the tab has run out: a tone that was coming
    // for the pill (its colour ease) would be showing by now.
    await expect
      .poll(() =>
        tab.evaluate(
          (el) =>
            el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
        ),
      )
      .toBe(0);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(heading(page)).toHaveText("Library");
    await expect(tab).toHaveAttribute("aria-current", "page");
    // The mark goes once the pill has finished (navigation.ts, settle): sample until then.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-nav-arrived")))
      .toBe(false);
    const seen = await page.evaluate(
      () =>
        (
          window as unknown as {
            pillSeen: { opacity: number[]; greyUnderFinger: boolean; scaled: boolean };
          }
        ).pillSeen,
    );
    expect(seen.greyUnderFinger, "the pill showed a tone under the wave").toBe(false);
    expect(seen.scaled, "the pill grew beside the wave").toBe(false);
    // Once the tab is current its pill grows in and stays: its opacity never falls. It did not grow,
    // go out and grow again on the new page.
    expect(seen.opacity.length, "the pill never showed").toBeGreaterThan(0);
    expect(
      seen.opacity.some(
        (value, index) => index > 0 && value < (seen.opacity[index - 1] ?? 0) - 0.01,
      ),
      "the pill went out and came back",
    ).toBe(false);
  });
});

test.describe("a podcast opened from a tab keeps that tab lit", () => {
  // Owner, 2026-11-02: opening a podcast from the Library, "the nav bar goes from down to up again".
  // The page settles in from the end side (8px, view-transitions.css); that travelling box stuck out
  // past the viewport, a phone's browser took the page for wider than the screen and laid out a taller
  // viewport for the length of the settle, so the fixed bar sat lower and came back up.
  test("the bottom bar holds still while a podcast opens from the Library", async ({ page }) => {
    await openWarm(page);
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    await expect(page.locator("html")).not.toHaveAttribute("data-nav-arrived");
    await page.evaluate(() => {
      const seen = { bottom: new Set<number>(), width: new Set<number>() };
      Object.assign(window, { barSeen: seen });
      const watch = (): void => {
        const nav = document.querySelector(".app-nav");
        if (nav) seen.bottom.add(Math.round(nav.getBoundingClientRect().bottom));
        seen.width.add(innerWidth);
        requestAnimationFrame(watch);
      };
      watch();
    });
    await page.locator("a[href^='/d/']").first().click();
    await expect(page.locator("main[data-latest='true']")).toBeVisible();
    // The page has finished settling.
    await expect
      .poll(() => page.locator(".shell").evaluate((shell) => shell.getAnimations().length))
      .toBe(0);
    const seen = await page.evaluate(() => {
      const { bottom, width } = (
        window as unknown as { barSeen: { bottom: Set<number>; width: Set<number> } }
      ).barSeen;
      return { bottom: [...bottom], width: [...width] };
    });
    expect(seen.bottom, "the bar's bottom edge moved").toHaveLength(1);
    expect(seen.width, "the viewport was laid out wider than the screen").toHaveLength(1);
  });

  // Owner, 2026-11-02: the Library's card for the latest podcast lit Latest, and the bar's pill grew
  // again under it. The tab says where you are in the app; the podcast is the same from any of them.
  test("the latest podcast, opened from the Library, stays under the Library", async ({ page }) => {
    await openWarm(page);
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    // Let the Library's own pill finish: one still growing would be carried into the podcast.
    await expect(page.locator("html")).not.toHaveAttribute("data-nav-arrived");
    await page.evaluate(() => {
      const w = window as unknown as { __grew: number };
      w.__grew = 0;
      document.addEventListener("astro:after-swap", () => {
        const pill = document.querySelector(
          '.app-nav-item[aria-current="page"] .app-nav-indicator',
        );
        w.__grew = pill?.getAnimations({ subtree: true }).length ?? 0;
      });
    });
    await page.locator("a[href^='/d/']").first().click();
    await expect(page.locator("main[data-latest='true']")).toBeVisible();
    await expect(item(page, "/library")).toHaveAttribute("aria-current", "page");
    await expect(item(page, "/")).not.toHaveAttribute("aria-current", "page");
    await expect(page.locator("a[data-back]")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __grew: number }).__grew)).toBe(0);

    // A reload is the same visit.
    await page.reload();
    await expect(item(page, "/library")).toHaveAttribute("aria-current", "page");

    // Today's own tab still goes to Today, which is lit there.
    await item(page, "/").click();
    await expect(item(page, "/")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("a[data-back]")).toHaveCount(0);
  });
});

// Owner, 2026-11-02: tapping a Library card waited on the server, because nothing had asked for the
// card's page before the tap. The cards in view are fetched while the page is idle, a few at most.
test.describe("a Library card's page is asked for before the tap", () => {
  test("the cards in view are fetched ahead, each once", async ({ page }) => {
    await openWarm(page);
    await page.evaluate(() => {
      const asked: string[] = [];
      (window as unknown as { __asked: string[] }).__asked = asked;
      const original = window.fetch;
      window.fetch = (input, init) => {
        const path = new URL(input instanceof Request ? input.url : String(input), location.href)
          .pathname;
        if (/^\/(e|d)\//.test(path)) asked.push(path);
        return original.call(window, input, init);
      };
    });
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    const asked = () => page.evaluate(() => (window as unknown as { __asked: string[] }).__asked);
    await expect.poll(async () => (await asked()).length).toBeGreaterThan(0);
    const paths = await asked();
    expect(new Set(paths).size).toBe(paths.length);
  });
});

// Owner, 2026-11-02: the page arrives from the side of the tab you came from, and a card you tapped
// holds its press until its page is there (a press that faded before the page came read as two ripples).
test.describe("a move says which way it went", () => {
  test("a tab further along the bar marks next, a tab before it prev, a key neither", async ({
    page,
  }) => {
    await openWarm(page);
    await page.evaluate(() => {
      const w = window as unknown as { __dirs: (string | null)[] };
      w.__dirs = [];
      // Registered after the app's own listeners: the mark is on the page that is arriving.
      document.addEventListener("astro:after-swap", () => {
        w.__dirs.push(document.documentElement.getAttribute("data-nav-dir"));
      });
    });
    const dirs = () => page.evaluate(() => (window as unknown as { __dirs: unknown[] }).__dirs);
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    await item(page, "/").click();
    await expect.poll(async () => (await dirs()).length).toBe(2);
    expect(await dirs()).toEqual(["next", "prev"]);

    // A key starts the move: nothing slides.
    await item(page, "/library").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await dirs()).length).toBe(3);
    expect((await dirs())[2]).toBeNull();
  });

  test("a tapped Library card holds its press until its page has arrived", async ({ page }) => {
    await openWarm(page);
    await item(page, "/library").click();
    await expect(heading(page)).toHaveText("Library");
    await page.evaluate(() => {
      const w = window as unknown as { __held: boolean[] };
      w.__held = [];
      document.addEventListener("astro:before-preparation", (event) => {
        const card = (event as unknown as { sourceElement?: Element }).sourceElement?.closest(
          "a.card-link",
        );
        // The page is held back until the test lets it go, so the press is read while it is on the way.
        const load = event.loader;
        const hold = new Promise<void>((resolve) => {
          (w as unknown as { __release: () => void }).__release = resolve;
        });
        event.loader = async () => {
          await hold;
          w.__held.push(card?.hasAttribute("data-pending") ?? false);
          await load();
        };
      });
    });
    const tap = page.locator("a.card-link[href^='/e/'], a.card-link[href^='/d/']").first().click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __release?: () => void }).__release !== undefined,
        ),
      )
      .toBe(true);
    await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await tap;
    await expect(page.locator("a[data-back]")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __held: boolean[] }).__held)).toEqual([
      true,
    ]);
  });
});

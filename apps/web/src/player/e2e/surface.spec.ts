import type { Page } from "@playwright/test";
import { coverFrame } from "../core/coverMorph";
import { type Box, center, expect, line, test, visibleCovers } from "./helpers";

const WIDE_PX = 640;
/** From 64rem the bar keeps its own cover and nothing flies; below it there is a bottom navigation. */
const FLIGHT_MAX_PX = 1024;

/** The largest difference between two boxes' left edge, top edge and width. */
function apart(a: Box, b: Box): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width));
}

/** The bottom navigation as a person sees it: how far it has slid and what is on top of it. */
interface NavProbe {
  /** Its translate, in px: how far down it has gone. */
  translate: number;
  height: number;
  /** How much of it is still on screen, in px. */
  onScreen: number;
  /** For points across the part still on screen: whether the topmost element there is in it. */
  hits: boolean[];
  p: number;
}

function probeNav(page: Page): Promise<NavProbe> {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>("[data-bottom-nav]");
    const sheet = document.querySelector<HTMLElement>("[data-player-page]");
    if (!nav || !sheet) throw new Error("no navigation or no player page");
    const rect = nav.getBoundingClientRect();
    const bottom = Math.min(rect.bottom, window.innerHeight);
    const y = (rect.top + bottom) / 2;
    return {
      translate: new DOMMatrix(getComputedStyle(nav).transform).m42,
      height: rect.height,
      onScreen: bottom - rect.top,
      hits: [0.1, 0.5, 0.9].map((share) => {
        const hit = document.elementFromPoint(rect.left + rect.width * share, y);
        return hit !== null && nav.contains(hit);
      }),
      p: Number.parseFloat(getComputedStyle(sheet).getPropertyValue("--p")) || 0,
    };
  });
}

/**
 * One frame of the navigation: the surface's state, how much of the navigation is on screen, and
 * whether it is on top there.
 */
interface NavFrame {
  state: string;
  onScreen: number;
  onTop: boolean;
}

/**
 * Samples every frame from now until the returned function is called. Where the navigation takes
 * input, what is on top is what elementFromPoint finds; while the open player has made it inert,
 * hit testing passes through it, so its stacking order against the surface's stands in.
 */
async function watchNav(page: Page): Promise<() => Promise<NavFrame[]>> {
  await page.evaluate(() => {
    const frames: NavFrame[] = [];
    const store = window as unknown as { __navFrames: NavFrame[]; __navWatch: boolean };
    store.__navFrames = frames;
    store.__navWatch = true;
    const step = (): void => {
      const surface = document.querySelector<HTMLElement>("[data-player-surface]");
      const nav = document.querySelector<HTMLElement>("[data-bottom-nav]");
      if (surface && nav) {
        const rect = nav.getBoundingClientRect();
        const bottom = Math.min(rect.bottom, window.innerHeight);
        const hit = document.elementFromPoint(rect.left + rect.width / 2, (rect.top + bottom) / 2);
        const above =
          Number(getComputedStyle(nav).zIndex) > Number(getComputedStyle(surface).zIndex);
        frames.push({
          state: surface.dataset.state ?? "",
          onScreen: bottom - rect.top,
          onTop: nav.inert ? above : hit !== null && nav.contains(hit),
        });
      }
      if (store.__navWatch) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return () =>
    page.evaluate(() => {
      const store = window as unknown as { __navFrames: NavFrame[]; __navWatch: boolean };
      store.__navWatch = false;
      return store.__navFrames;
    });
}

test.describe("one surface @surface", () => {
  test("the bar and the player are one mounted element, and nothing lives in a portal", async ({
    player,
    page,
  }) => {
    await player.open();
    await player.play();
    await player.openPlayer();
    const facts = await page.evaluate(() => {
      const slider = document.querySelector('[role="slider"][aria-label="Playback position"]');
      const open = [...document.querySelectorAll("button")].find((button) =>
        (button.getAttribute("aria-label") ?? "").startsWith("Player: "),
      );
      const surface = slider?.closest("[data-player-surface]") ?? null;
      return {
        sharedSurface: surface !== null && surface === open?.closest("[data-player-surface]"),
        surfaces: document.querySelectorAll("[data-player-surface]").length,
        inPortal: document.querySelectorAll(
          '[data-base-ui-portal] [class*="player-"], [data-base-ui-portal] [role="slider"]',
        ).length,
        insideIsland: surface?.closest("astro-island") !== null && surface !== null,
      };
    });
    expect(facts).toEqual({ sharedSurface: true, surfaces: 1, inPortal: 0, insideIsland: true });
  });

  test("the page is in the document before it is opened, collapsed and out of reach", async ({
    player,
  }) => {
    await player.open();
    await expect(player.surface).toHaveCount(1);
    await expect(player.surface).toHaveAttribute("data-state", "collapsed");
    await expect(player.sheet).toHaveAttribute("inert", "");
    await expect(player.sheet).toBeHidden();
    await player.play();
    await expect(player.openButton).toHaveAttribute("aria-expanded", "false");
    const controls = await player.openButton.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await expect(player.sheet).toHaveAttribute("id", controls ?? "");
    await player.openPlayer();
    // By attribute: on a phone the bar is out of the accessibility tree while the page is open.
    await expect(player.page.locator("[data-player-open]")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(player.surface).toHaveAttribute("aria-modal", "true");
  });

  test("the page rises from the bar's top edge, and below 64rem the bar's cover flies with it", async ({
    player,
    page,
    finger,
  }) => {
    await player.open();
    await player.play();
    const start = center(await player.dockSettled());
    const rest = await player.geometry();
    // At rest the one cover on screen is the bar's.
    expect(await visibleCovers(page)).toEqual(["bar"]);
    // A slow, short pull, held: the page has only just left the bar.
    const held = await finger.drag(line(start, { x: start.x, y: start.y - 48 }, 12), 30, {
      hold: true,
    });
    await expect(player.surface).toHaveAttribute("data-state", "dragging");
    await expect.poll(async () => (await player.geometry()).p).toBeGreaterThan(0.03);
    const now = await player.geometry();
    expect(now.p).toBeLessThan(0.2);
    // Travel is linear in p and ends with the page's top on the bar's top.
    expect(Math.abs(now.sheet.y - rest.dock.y * (1 - now.p))).toBeLessThanOrEqual(1);
    if (now.window.width < WIDE_PX) {
      // On a phone the bar rides up on the page's top edge.
      expect(Math.abs(now.dock.y - now.sheet.y)).toBeLessThanOrEqual(1);
    } else {
      // On a wide screen the bar does not move.
      expect(Math.abs(now.dock.y - rest.dock.y)).toBeLessThanOrEqual(0.5);
    }
    if (now.window.width < FLIGHT_MAX_PX) {
      // Still one cover: the bar's has become the one in flight, already grown on its way up.
      expect(await visibleCovers(page)).toEqual(["flight"]);
      expect(now.art.width).toBeGreaterThan(rest.thumb.width + 1);
      expect(now.art.y).toBeLessThan(rest.thumb.y);
    } else {
      // From 64rem nothing flies: the bar keeps its thumbnail where it was, the page has its own.
      await expect(page.locator("[data-player-art]")).toBeHidden();
      expect((await visibleCovers(page)).sort()).toEqual(["bar", "page"]);
      expect(apart(now.thumb, rest.thumb)).toBeLessThanOrEqual(0.5);
    }
    await held.release();
    // A short, slow pull is not a decision: it goes back, and the bar has its cover again.
    await player.collapsed();
    expect(await visibleCovers(page)).toEqual(["bar"]);
  });

  test("the flying cover leaves from the bar's cover and lands on the page's cover", async ({
    player,
    page,
    finger,
    browserName,
  }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= FLIGHT_MAX_PX, "the cover flies below 64rem only");
    test.skip(
      browserName === "webkit",
      "Playwright has no touch input in WebKit, so player.ts pulls with a held mouse drag, and mobile WebKit does not carry that to the sheet",
    );
    await player.open();
    await player.play();
    const start = center(await player.dockSettled());
    const rest = await player.geometry();
    // Just past the slop: the cover has taken off and has not gone anywhere yet.
    const first = await finger.drag(line(start, { x: start.x, y: start.y - 14 }, 7), 30, {
      hold: true,
    });
    await expect(player.surface).toHaveAttribute("data-state", "dragging");
    const takeoff = await player.geometry();
    expect(takeoff.p).toBeLessThan(0.01);
    // Two pixels past the slop is a quarter of a percent of the way: under two pixels of flight.
    expect(apart(takeoff.art, rest.thumb)).toBeLessThanOrEqual(3);
    expect(await visibleCovers(page)).toEqual(["flight"]);
    await first.release();
    await player.collapsed();
    // Pulled past the top and held: the page is in place and the cover is on its slot.
    // To the top edge and no further: a pointer that leaves the window ends the gesture.
    const second = await finger.drag(line(start, { x: start.x, y: 3 }, 20), 16, {
      hold: true,
    });
    await expect.poll(async () => (await player.geometry()).p).toBe(1);
    const landing = await player.geometry();
    expect(landing.state).toBe("dragging");
    expect(apart(landing.art, landing.slot)).toBeLessThanOrEqual(1);
    await second.release();
    await player.expanded();
    // At rest the page's own cover takes over, where the flying one was.
    expect(await visibleCovers(page)).toEqual(["page"]);
    expect(apart((await player.geometry()).slot, landing.art)).toBeLessThanOrEqual(1);
  });

  test("the flying cover follows the finger back down and lands on the bar's cover", async ({
    player,
    page,
    finger,
    browserName,
  }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= FLIGHT_MAX_PX, "the cover flies below 64rem only");
    test.skip(
      browserName === "webkit",
      "Playwright has no touch input in WebKit, so player.ts pulls with a held mouse drag, and mobile WebKit does not carry that to the sheet",
    );
    await player.open();
    await player.play();
    const start = center(await player.dockSettled());
    const rest = await player.geometry();
    const up = Math.round(rest.window.height * 0.5);
    const held = await finger.drag(line(start, { x: start.x, y: start.y - up }, 12), 30, {
      hold: true,
    });
    await expect.poll(async () => (await player.geometry()).p).toBeGreaterThan(0.4);
    const high = await player.geometry();
    // Back down most of the way, without letting go: the cover turns with the finger.
    await held.move(
      line({ x: start.x, y: start.y - up }, { x: start.x, y: start.y - 40 }, 10).slice(1),
    );
    await expect.poll(async () => (await player.geometry()).p).toBeLessThan(0.1);
    const low = await player.geometry();
    expect(low.state).toBe("dragging");
    for (const now of [high, low]) {
      const expected = coverFrame(now.p, {
        fromX: now.morph["from-x"] ?? Number.NaN,
        fromY: now.morph["from-y"] ?? Number.NaN,
        toX: now.morph["to-x"] ?? Number.NaN,
        toY: now.morph["to-y"] ?? Number.NaN,
        size: now.morph.size ?? Number.NaN,
        scale: now.morph.scale ?? Number.NaN,
      });
      expect(Math.abs(now.artTransform.x - expected.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(now.artTransform.y - expected.y)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(now.artTransform.scale - expected.scale)).toBeLessThanOrEqual(0.005);
    }
    // The same flight both ways: the one measured as the page left rest.
    expect(low.morph).toEqual(high.morph);
    expect(low.art.width).toBeLessThan(high.art.width);
    expect(await visibleCovers(page)).toEqual(["flight"]);
    await held.release();
    // Let go near the bar, the pull is no decision: the page goes down and the cover comes home.
    await player.collapsed();
    expect(await visibleCovers(page)).toEqual(["bar"]);
    expect(apart((await player.geometry()).thumb, rest.thumb)).toBeLessThanOrEqual(0.5);
  });

  test("per-frame motion is custom properties only, and none is left at rest", async ({
    player,
    page,
    finger,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Playwright has no touch input in WebKit, so player.ts pulls with a held mouse drag, and mobile WebKit does not carry that to the sheet",
    );
    await player.open();
    await player.play();
    const start = center(await player.dockSettled());
    const rest = await player.geometry();
    const pull = Math.round(rest.window.height * 0.45);
    const held = await finger.drag(line(start, { x: start.x, y: start.y - pull }, 16), 20, {
      hold: true,
    });
    await expect.poll(async () => (await player.geometry()).p).toBeGreaterThan(0.3);
    const now = await player.geometry();
    expect(now.state).toBe("dragging");
    if (now.window.width < FLIGHT_MAX_PX) {
      // Mid-flight, exactly where the formula in coverMorph.ts puts it for the flight measured.
      expect(now.artTransform.scale).toBeGreaterThan(0.05);
      expect(now.artTransform.scale).toBeLessThan(0.98);
      const expected = coverFrame(now.p, {
        fromX: now.morph["from-x"] ?? Number.NaN,
        fromY: now.morph["from-y"] ?? Number.NaN,
        toX: now.morph["to-x"] ?? Number.NaN,
        toY: now.morph["to-y"] ?? Number.NaN,
        size: now.morph.size ?? Number.NaN,
        scale: now.morph.scale ?? Number.NaN,
      });
      expect(Math.abs(now.artTransform.x - expected.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(now.artTransform.y - expected.y)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(now.artTransform.scale - expected.scale)).toBeLessThanOrEqual(0.005);
    }
    // The stylesheet owns what the property means.
    const written = await page.evaluate(() =>
      [...document.querySelectorAll("[data-player-surface], [data-player-surface] *")]
        .map((element) => element.getAttribute("style") ?? "")
        .filter((style) => /(^|;)\s*(transform|opacity|top|left|height|width)\s*:/.test(style)),
    );
    expect(written).toEqual([]);
    await held.release();
    // Far enough, and not moving back: it opens.
    await player.expanded();
    expect(await player.progress()).toBeCloseTo(1, 2);
    // At rest nothing that motion wrote is left behind.
    const leftovers = await page.evaluate(() =>
      [...document.querySelectorAll("[data-player-surface] *")]
        .map((element) => element.getAttribute("style") ?? "")
        .filter((style) => /--p\s*:|--art-/.test(style)),
    );
    expect(leftovers).toEqual([]);
  });

  test("on a phone the navigation stays above the rising page and slides away in step with it", async ({
    player,
    page,
    finger,
    browserName,
  }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= FLIGHT_MAX_PX, "the bottom navigation is below 64rem");
    test.skip(
      browserName === "webkit",
      "Playwright has no touch input in WebKit, so player.ts pulls with a held mouse drag, and mobile WebKit does not carry that to the sheet",
    );
    await player.open();
    await player.play();
    const start = center(await player.dockSettled());
    const stop = await watchNav(page);
    // The first frames of a pull, just past the slop: the page is up behind the bar already.
    const held = await finger.drag(line(start, { x: start.x, y: start.y - 14 }, 7), 30, {
      hold: true,
    });
    await expect(player.surface).toHaveAttribute("data-state", "dragging");
    const first = await probeNav(page);
    expect(first.hits).toEqual([true, true, true]);
    expect(first.translate).toBeLessThanOrEqual(1);
    // Mid-drag, twice: still on top, and further down each time, by p of its own height.
    let fingerY = start.y - 14;
    let before = first;
    for (const reach of [200, 380]) {
      const to = { x: start.x, y: start.y - reach };
      await held.move(line({ x: start.x, y: fingerY }, to, 8).slice(1));
      fingerY = to.y;
      const now = await probeNav(page);
      expect(now.onScreen).toBeGreaterThan(1);
      expect(now.hits).toEqual([true, true, true]);
      expect(now.translate).toBeGreaterThan(before.translate + 5);
      expect(Math.abs(now.translate - now.p * now.height)).toBeLessThanOrEqual(1);
      before = now;
    }
    await held.release();
    await player.expanded();
    await page.keyboard.press("Escape");
    await player.collapsed();
    // Every frame of the pull, the spring up and the way back down, the first included: wherever
    // any of the navigation was on screen while the page moved, the navigation was on top.
    const frames = await stop();
    const moving = frames.filter(
      (frame) => frame.state !== "collapsed" && frame.state !== "expanded" && frame.onScreen > 0.5,
    );
    for (const state of ["dragging", "expanding", "collapsing"]) {
      expect(
        moving.some((frame) => frame.state === state),
        state,
      ).toBe(true);
    }
    expect(moving.filter((frame) => !frame.onTop)).toEqual([]);
    expect(await probeNav(page)).toMatchObject({ translate: 0, hits: [true, true, true] });
  });

  test("a bottom navigation is told how far the page is, and let go at rest", async ({
    player,
    page,
    finger,
  }) => {
    await player.open();
    // The shell's bottom navigation, as its contract describes it: an element and its height.
    await page.evaluate(() => {
      const nav = document.createElement("nav");
      nav.setAttribute("data-bottom-nav", "");
      nav.setAttribute("aria-label", "Sections");
      document.body.append(nav);
      document.documentElement.style.setProperty("--bottom-nav-height", "56px");
    });
    const navP = (): Promise<string> =>
      page.evaluate(
        () =>
          document
            .querySelector<HTMLElement>("[data-bottom-nav]")
            ?.style.getPropertyValue("--player-p") ?? "missing",
      );
    await player.play();
    const start = center(await player.dockSettled());
    const rest = await player.geometry();
    // The bar sits on top of the navigation.
    expect(
      Math.abs(rest.dock.y + rest.dock.height - (rest.window.height - 56)),
    ).toBeLessThanOrEqual(1);
    expect(await navP()).toBe("");
    const held = await finger.drag(line(start, { x: start.x, y: start.y - 120 }, 12), 30, {
      hold: true,
    });
    await expect.poll(async () => (await player.geometry()).p).toBeGreaterThan(0.1);
    const now = await player.geometry();
    expect(Number(await navP())).toBeCloseTo(now.p, 3);
    // The page still leaves from the bar's top edge, wherever the navigation put the bar.
    expect(Math.abs(now.sheet.y - rest.dock.y * (1 - now.p))).toBeLessThanOrEqual(1);
    await held.release();
    await player.collapsed();
    expect(await navP()).toBe("");
    await player.dockSettled();
    await player.openPlayer();
    expect(await navP()).toBe("1");
    await page.keyboard.press("Escape");
    await player.collapsed();
    expect(await navP()).toBe("");
  });

  test("on a wide screen the page fills the window above the bar, and the bar keeps working", async ({
    player,
    page,
    finger,
  }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width < WIDE_PX, "wide screens only");
    await player.open();
    await player.play();
    await player.openPlayer();
    const now = await player.geometry();
    // Edge to edge of what the layout has: the window, less a classic scrollbar's gutter.
    expect(now.surface.width).toBeGreaterThan(now.window.width - 20);
    expect(Math.abs(now.sheet.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.width - now.surface.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.y + now.sheet.height - now.dock.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.dock.y + now.dock.height - now.window.height)).toBeLessThanOrEqual(1);
    // The bar is not behind the modal, but it does not say the page's transport twice: its play
    // button steps aside while the page above holds the one play control.
    await expect(player.dock.getByRole("button", { name: "Pause" })).toBeHidden();
    await finger.press(
      player.dialog.getByRole("button", { name: "Pause", exact: true }).filter({ visible: true }),
    );
    await expect(player.root).toHaveAttribute("data-player-state", "paused");
    await player.expanded();
    // And its open button closes the page it opened.
    await finger.press(player.openButton);
    await player.collapsed();
  });

  test("on a tablet in portrait the page also fills the window above the bar", async ({
    player,
    page,
    browserName,
    isMobile,
  }) => {
    test.skip(browserName !== "chromium" || Boolean(isMobile), "resized from the desktop project");
    await page.setViewportSize({ width: 820, height: 1180 });
    await player.open();
    await player.play();
    await player.openPlayer();
    const now = await player.geometry();
    expect(Math.abs(now.sheet.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.width - now.surface.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.y + now.sheet.height - now.dock.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.dock.y + now.dock.height - 1180)).toBeLessThanOrEqual(1);
  });

  test("on a phone the page covers the whole screen and the bar steps out", async ({
    player,
    page,
  }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= WIDE_PX, "phones only");
    await player.open();
    await player.play();
    await player.openPlayer();
    const now = await player.geometry();
    expect(Math.abs(now.sheet.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.width - now.window.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.height - now.window.height)).toBeLessThanOrEqual(1);
    await expect(player.openButton).toBeHidden();
  });
});

import { test as base, expect, type Locator, type Page } from "@playwright/test";

export interface AudioProbe {
  /** The state of the one Audio object the player created, read from the real element. */
  read(): Promise<AudioSnapshot | null>;
  count(): Promise<number>;
}

export interface AudioSnapshot {
  src: string;
  currentTime: number;
  paused: boolean;
  playbackRate: number;
  preservesPitch: boolean;
  duration: number;
  inDom: boolean;
}

/** Which page the specs drive: the dev lab, or a real digest page from the fixture build. */
export interface PlayerOptions {
  target: "lab" | "site";
}

interface TargetFacts {
  /** The digest page with narration. */
  path: string;
  /** The page's date, which names the player dialog. */
  title: string;
  /** A second page reached by a client-side link, with the islands carried over. */
  nextLink: RegExp;
  nextUrl: RegExp;
  /** A digest the Generate mock can report as published, and where its page really lives. */
  generated: { id: string; servedFrom: string | null };
}

const TARGETS: Record<PlayerOptions["target"], TargetFacts> = {
  lab: {
    path: "/dev/player-lab",
    title: "Wednesday 14 January",
    nextLink: /^Earlier briefing, with audio$/,
    nextUrl: /player-lab-older/,
    // The lab has no /d/ route; the earlier lab page stands in for it.
    generated: { id: "2026-01-12", servedFrom: "/dev/player-lab-older" },
  },
  site: {
    path: "/d/2026-10-07",
    title: "Wednesday 7 October",
    nextLink: /^Library$/,
    nextUrl: /\/library$/,
    generated: { id: "2026-10-05", servedFrom: null },
  },
};

declare global {
  interface Window {
    __audios: HTMLAudioElement[];
  }
}

export interface Point {
  x: number;
  y: number;
}

/** One pointer, driven the way the device would: a finger where there is touch, a mouse otherwise. */
export interface Finger {
  readonly touch: boolean;
  /** A tap or a click on an element. */
  press(target: Locator): Promise<void>;
  /** A tap or a click at a point, whatever is under it at that moment. */
  pressAt(point: Point): Promise<void>;
  /**
   * Presses at the first point and travels the rest. `stepMs` sets the speed: a flick is a few
   * milliseconds per step, a slow drag tens. With `hold` the pointer stays down until `release`.
   */
  drag(
    path: Point[],
    stepMs: number,
    options?: { hold?: boolean },
  ): Promise<{ release(): Promise<void> }>;
}

/** Points along a straight line, `count` of them, ending exactly on `to`. */
export function line(from: Point, to: Point, count: number): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / count,
    y: from.y + ((to.y - from.y) * index) / count,
  }));
}

/**
 * A real touch gesture through Chromium's input pipeline, so pointer events, pointer capture and
 * velocity behave as they do under a finger.
 */
async function touchPath(
  page: Page,
  path: Point[],
  stepMs: number,
  hold: boolean,
): Promise<{ release(): Promise<void> }> {
  const client = await page.context().newCDPSession(page);
  const release = async (): Promise<void> => {
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
  };
  const [first, ...rest] = path;
  if (!first) return { release };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
  for (const point of rest) {
    await page.waitForTimeout(stepMs);
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
  }
  if (!hold) await release();
  return { release };
}

async function mouseDrag(
  page: Page,
  path: Point[],
  stepMs: number,
  hold: boolean,
): Promise<{ release(): Promise<void> }> {
  const release = (): Promise<void> => page.mouse.up();
  const [first, ...rest] = path;
  if (!first) return { release: async () => undefined };
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) {
    await page.waitForTimeout(stepMs);
    await page.mouse.move(point.x, point.y);
  }
  if (!hold) await release();
  return { release };
}

/** What a body child must be for the open player to leave it alone. Mirrors core/modalScope.ts. */
const CONSISTENCY_CHECK = (): string[] => {
  const surface = document.querySelector<HTMLElement>("[data-player-surface]");
  if (!surface) return [];
  const problems: string[] = [];
  const state = surface.dataset.state ?? "missing";
  const root = document.documentElement;
  const sheet = surface.querySelector<HTMLElement>("[data-player-page]");
  if (!sheet) return ["the surface has no page"];
  const describe = (element: Element): string =>
    `<${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
      element.className && typeof element.className === "string" ? `.${element.className}` : ""
    }>`;
  const isExempt = (element: Element): boolean =>
    element.contains(surface) ||
    element.matches("script, style, template, link, meta, noscript") ||
    element.matches("[aria-live]") ||
    element.querySelector("[aria-live], [popover]") !== null;
  const others = [...document.body.children].filter((element) => !isExempt(element));
  if (state === "expanded") {
    for (const element of others) {
      if (!element.hasAttribute("inert")) problems.push(`${describe(element)} is not inert`);
    }
    if (root.getAttribute("data-player") !== "open") problems.push("html is not data-player=open");
    if (sheet.getAttribute("role") !== "dialog") problems.push("the page is not a dialog");
    if (sheet.hasAttribute("inert")) problems.push("the expanded page is inert");
    const rect = sheet.getBoundingClientRect();
    const inside =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top >= -1 &&
      rect.left >= -1 &&
      rect.bottom <= window.innerHeight + 1 &&
      rect.right <= window.innerWidth + 1;
    if (!inside) {
      problems.push(
        `the page is outside the viewport: ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)} in ${window.innerWidth}x${window.innerHeight}`,
      );
    }
    if (getComputedStyle(sheet).visibility !== "visible") problems.push("the page is not visible");
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || !sheet.contains(hit)) problems.push("something covers the expanded page");
  } else if (state === "collapsed") {
    const marked = document.querySelectorAll("[data-player-inert]");
    if (marked.length > 0)
      problems.push(`${marked.length} element(s) still carry the inert marker`);
    if (root.getAttribute("data-player") !== "closed") {
      problems.push("html is not data-player=closed");
    }
    if (!sheet.hasAttribute("inert")) problems.push("the collapsed page is not inert");
    if (sheet.getAttribute("role") === "dialog") problems.push("the collapsed page is a dialog");
  } else {
    problems.push(`the surface did not come to rest: data-state=${state}`);
  }
  return problems;
};

/**
 * The invariant every player test must leave true: the page is expanded if and only if the rest of
 * the document is inert and the page is inside the viewport; when it is collapsed nothing carries
 * the inert marker and the root says the player is closed.
 */
export async function expectConsistent(page: Page): Promise<void> {
  if (page.isClosed()) return;
  const restState = (): Promise<string> =>
    page
      .evaluate(
        () =>
          document.querySelector<HTMLElement>("[data-player-surface]")?.dataset.state ?? "absent",
      )
      .catch(() => "absent");
  await expect
    .poll(restState, { message: "the player surface comes to rest", timeout: 6_000 })
    .toMatch(/^(expanded|collapsed|absent)$/);
  const problems = await page.evaluate(CONSISTENCY_CHECK).catch(() => [] as string[]);
  expect(problems, "the player is in a consistent state").toEqual([]);
}

export const test = base.extend<
  { lab: LabPage; audio: AudioProbe; finger: Finger } & PlayerOptions
>({
  target: ["lab", { option: true }],
  page: async ({ page }, use) => {
    // Any console error or warning from the page is a failure, apart from the lab's own missing
    // /d/ routes, which a "Open the new briefing" test follows on purpose.
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return;
      // The browser logs every non-2xx response on its own; the tests answer 401, 429 and 503 on purpose.
      if (/Failed to load resource/.test(message.text())) return;
      // Astro's router says this itself whenever reduced motion is on.
      if (message.text().startsWith("[transitions]")) return;
      // WebKit's note about Astro's module preloads on a page that hydrates when idle.
      if (message.text().includes("was preloaded using link preload but not used")) return;
      // Playwright's own note when a test asks for service workers to be blocked.
      if (message.text().includes("Service Worker registration blocked by Playwright")) return;
      problems.push(`[${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`[pageerror] ${error.message}`));
    await page.addInitScript(() => {
      window.__audios = [];
      const Original = window.Audio;
      window.Audio = class extends Original {
        constructor(src?: string) {
          super(src);
          window.__audios.push(this);
        }
      } as typeof Audio;
    });
    await use(page);
    await expectConsistent(page);
    expect(problems).toEqual([]);
  },
  finger: async ({ page, hasTouch, browserName }, use) => {
    const touch = Boolean(hasTouch);
    // Chromium can synthesize a whole touch sequence; elsewhere a mouse stands in for drags.
    const realTouch = touch && browserName === "chromium";
    await use({
      touch,
      press: (target) => (touch ? target.tap() : target.click()),
      pressAt: (point) =>
        touch ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y),
      drag: (path, stepMs, options = {}) =>
        realTouch
          ? touchPath(page, path, stepMs, options.hold ?? false)
          : mouseDrag(page, path, stepMs, options.hold ?? false),
    });
  },
  lab: async ({ page, target, finger }, use) => {
    await use(new LabPage(page, target, finger));
  },
  audio: async ({ page }, use) => {
    await use({
      count: () => page.evaluate(() => window.__audios.length),
      read: () =>
        page.evaluate(() => {
          const element = window.__audios[0];
          if (!element) return null;
          return {
            src: element.src,
            currentTime: element.currentTime,
            paused: element.paused,
            playbackRate: element.playbackRate,
            preservesPitch: element.preservesPitch,
            duration: element.duration,
            inDom: element.isConnected,
          };
        }),
    });
  },
});

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SurfaceGeometry {
  state: string;
  p: number;
  /** The whole surface: the box everything inside is laid out in. */
  surface: Box;
  sheet: Box;
  dock: Box;
  window: { width: number; height: number };
}

export function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export class LabPage {
  readonly facts: TargetFacts;

  constructor(
    readonly page: Page,
    readonly target: PlayerOptions["target"],
    readonly finger: Finger,
  ) {
    this.facts = TARGETS[target];
  }

  async open(path = this.facts.path): Promise<void> {
    await this.page.goto(path, { waitUntil: "networkidle" });
    // The islands hydrate when the browser is idle.
    await this.page.waitForFunction(() => document.querySelector("astro-island[ssr]") === null);
    await expect(this.root).toHaveAttribute("data-mini", "hidden");
  }

  get root() {
    return this.page.locator("html");
  }

  /** The hero button, which the player drives from [data-play-digest]. */
  get cta() {
    return this.page.locator("[data-play-digest]");
  }

  get surface() {
    return this.page.locator("[data-player-surface]");
  }

  /** The bar. */
  get dock() {
    return this.page.getByRole("region", { name: "Audio player" });
  }

  get openButton() {
    return this.page.getByRole("button", { name: /^Player: / });
  }

  /** The expanded player: the page, while it is a dialog. */
  get dialog() {
    return this.page.locator('[data-player-page][role="dialog"]');
  }

  /** The page element itself, present whether or not it is expanded. */
  get sheet() {
    return this.page.locator("[data-player-page]");
  }

  get closeButton() {
    return this.page.getByRole("button", { name: "Close the player" });
  }

  /**
   * The timeline that is drawn: the page's "Playback position", or on a wide screen with a mouse
   * the bar's "Seek" (one timeline, the bar's). Where both show, the page's comes first.
   */
  get scrubber() {
    return this.page.getByRole("slider", { name: /^(Playback position|Seek)$/ }).first();
  }

  /** Only the page's own scrubber, which the page's lazy half renders. */
  get pageScrubber() {
    return this.dialog.getByRole("slider", { name: "Playback position" });
  }

  async boxOf(target: Locator): Promise<Box> {
    const box = await target.boundingBox();
    if (!box) throw new Error("element has no box");
    return box;
  }

  /** Starts narration from the hero button and waits for the bar to be in place. */
  async play(): Promise<void> {
    await this.finger.press(this.cta);
    await expect(this.root).toHaveAttribute("data-player-state", "playing");
    await this.dockSettled();
  }

  /** The bar slides in; a gesture aimed at it needs it at rest. */
  async dockSettled(): Promise<Box> {
    await expect(this.root).toHaveAttribute("data-mini", "visible");
    await expect(this.openButton).toBeVisible();
    let previous = "";
    await expect
      .poll(async () => {
        const box = await this.openButton.boundingBox();
        const now = JSON.stringify(box);
        const steady = now === previous;
        previous = now;
        return steady;
      })
      .toBe(true);
    return this.boxOf(this.openButton);
  }

  async openPlayer(): Promise<void> {
    await this.finger.press(this.openButton);
    await this.expanded();
  }

  /** Expanded, at rest, and on screen. */
  async expanded(): Promise<void> {
    await expect(this.root).toHaveAttribute("data-player", "open");
    await this.settled();
    await expect(this.dialog).toBeVisible();
    await expect(this.dialog).toBeInViewport({ ratio: 0.9 });
  }

  async collapsed(): Promise<void> {
    await expect(this.root).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
    await this.settled();
    await expect(this.dialog).toHaveCount(0);
  }

  /** Waits for the surface's spring to come to rest, open or closed. */
  async settled(): Promise<void> {
    await expect
      .poll(() =>
        this.page.evaluate(() => {
          const state = document.querySelector<HTMLElement>("[data-player-surface]")?.dataset.state;
          return state === "expanded" || state === "collapsed";
        }),
      )
      .toBe(true);
  }

  /** Progress `p` of the surface, 0 collapsed and 1 expanded, read from the page's own style. */
  async progress(): Promise<number> {
    return (await this.geometry()).p;
  }

  /**
   * Where everything on the surface is, read in one pass, so no frame can slip in between two
   * readings of a page that a held finger is still moving.
   */
  geometry(): Promise<SurfaceGeometry> {
    return this.page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>("[data-player-surface]");
      const find = (selector: string): HTMLElement => {
        const element = surface?.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`no ${selector}`);
        return element;
      };
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      if (!surface) throw new Error("no player surface");
      const sheet = find("[data-player-page]");
      const p = Number.parseFloat(getComputedStyle(sheet).getPropertyValue("--p"));
      return {
        state: surface.dataset.state ?? "",
        p: Number.isFinite(p) ? p : 0,
        surface: box(surface),
        sheet: box(sheet),
        dock: box(find("[data-player-dock]")),
        window: { width: window.innerWidth, height: window.innerHeight },
      };
    });
  }

  /** Follows a client-side link to another page; the islands and the narration carry over. */
  async goToNextPage(): Promise<void> {
    const link = this.page.getByRole("link", { name: this.facts.nextLink }).first();
    // From the keyboard, so nothing that floats over the link can take the press.
    await link.focus();
    await this.page.keyboard.press("Enter");
    await expect(this.page).toHaveURL(this.facts.nextUrl);
  }

  /** How far along the bar's progress line is, 0 to 1. */
  async progressOf(): Promise<number> {
    return this.page
      .locator(".dock-progress-fill")
      .evaluate((fill) => Number(fill.style.getPropertyValue("--player-progress")));
  }
}

export { expect };

import { test as base, expect, type Locator, type Page, type Route } from "@playwright/test";

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

/** The fixture site's facts the specs lean on (apps/web/scripts/buildFixtures.ts). */
export const SITE = {
  /** The digest page with narration. */
  path: "/d/2026-10-07",
  /** The page's date, which names the player dialog. */
  title: "Wednesday 7 October",
  /** A second page reached by a client-side link, with the islands carried over. */
  nextLink: /^Library$/,
  nextUrl: /\/library$/,
  /** A briefing with no audio: Up next offers it, and the Generate mock reports it as published. */
  earlier: "2026-10-05",
} as const;

/**
 * Answers a request for a narration file with the fixture site's own recording, in full: the
 * request's headers (a Range among them) stay behind, so the answer is a plain 200.
 */
export async function fulfillNarration(route: Route): Promise<void> {
  const url = new URL("/fixtures/audio.wav", route.request().url()).toString();
  await route.fulfill({ response: await route.fetch({ url, headers: {} }) });
}

/**
 * A briefing with no audio yet: the server lists its segments with no files, and makes each one
 * when asked, after `delayMs`. Returns the keys that were asked for, in order.
 */
export async function serveNarration(
  page: Page,
  delayMs: number,
  /** The page whose stories are narrated, when it is not the one open. */
  from?: string,
): Promise<string[]> {
  const ids = await page.evaluate(async (path) => {
    const html = path
      ? new DOMParser().parseFromString(await (await fetch(path)).text(), "text/html")
      : document;
    const data = JSON.parse(html.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.items as { id: string }[]).map((item) => item.id);
  }, from);
  const keys = ["intro", ...ids];
  const made: string[] = [];
  const finished = new Set<string>();
  await page.route("**/api/narrate?digest=*", (route) =>
    route.fulfill({
      json: {
        status: 200,
        audio: null,
        timeline: null,
        ms_per_character: 62,
        segments: keys.map((key) => ({
          key,
          item_id: key === "intro" ? null : key,
          characters: 300,
          // The address the file will have once made, as the real server answers: a guess.
          audio: { url: `/narrated/${key}.mp3`, duration_ms: 18_600, confirmed: false },
        })),
      },
    }),
  );
  // The file is not there until it has been made, as on the blob store.
  await page.route("**/narrated/*.mp3", (route) => {
    const key = new URL(route.request().url()).pathname.split("/").pop()?.replace(".mp3", "") ?? "";
    return made.includes(key) && finished.has(key)
      ? fulfillNarration(route)
      : route.fulfill({ status: 404, body: "" });
  });
  await page.route("**/api/narrate", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment } = route.request().postDataJSON() as { segment: string };
    made.push(segment);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    finished.add(segment);
    return route.fulfill({
      json: {
        status: 200,
        segment: {
          key: segment,
          item_id: segment === "intro" ? null : segment,
          characters: 300,
          audio: { url: `/narrated/${segment}.mp3`, duration_ms: 17_000, confirmed: true },
        },
      },
    });
  });
  return made;
}

declare global {
  interface Window {
    __audios: HTMLAudioElement[];
  }
}

export interface Point {
  x: number;
  y: number;
}

/** A pointer that a drag left down. */
export interface HeldPointer {
  /** Travels on along `path`, at the drag's own speed, and stays down. */
  move(path: Point[]): Promise<void>;
  release(): Promise<void>;
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
  drag(path: Point[], stepMs: number, options?: { hold?: boolean }): Promise<HeldPointer>;
}

/** Points along a straight line, `count` of them, ending exactly on `to`. */
export function line(from: Point, to: Point, count: number): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / count,
    y: from.y + ((to.y - from.y) * index) / count,
  }));
}

/**
 * The time each event of a gesture means, in the seconds Chromium's input commands take. The page
 * reads speed from each event's own timeStamp, and under load the harness delivers moves 30 to 100
 * ms apart where 8 were asked for, so without a stated time a flick arrives as a slow drag and the
 * test measures the machine. A lift comes one step after the last move; a held one, when the test
 * lets go, which is never earlier than now.
 */
function gestureClock(stepMs: number): { next(): number; lift(held: boolean): number } {
  let at = Date.now() / 1000;
  const next = (): number => {
    at += stepMs / 1000;
    return at;
  };
  return { next, lift: (held) => (held ? Math.max(next(), Date.now() / 1000) : next()) };
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
): Promise<HeldPointer> {
  const client = await page.context().newCDPSession(page);
  const clock = gestureClock(stepMs);
  const lift = async (held: boolean): Promise<void> => {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
      timestamp: clock.lift(held),
    });
    await client.detach();
  };
  const move = async (points: Point[]): Promise<void> => {
    for (const point of points) {
      await page.waitForTimeout(stepMs);
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point],
        timestamp: clock.next(),
      });
    }
  };
  const [first, ...rest] = path;
  if (!first) return { move: async () => undefined, release: () => lift(true) };
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [first],
    timestamp: Date.now() / 1000,
  });
  await move(rest);
  if (!hold) await lift(false);
  return { move, release: () => lift(true) };
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
    if (surface.getAttribute("role") !== "dialog") problems.push("the surface is not a dialog");
    if (surface.getAttribute("aria-modal") !== "true") problems.push("the dialog is not modal");
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
    if (surface.getAttribute("role") === "dialog")
      problems.push("the collapsed player is a dialog");
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

export const test = base.extend<{ player: PlayerPage; audio: AudioProbe; finger: Finger }>({
  page: async ({ page }, use) => {
    // Any console error or warning from the page is a failure.
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
  finger: async ({ page, hasTouch }, use) => {
    const touch = Boolean(hasTouch);
    await use({
      touch,
      press: (target) => (touch ? target.tap() : target.click()),
      pressAt: (point) =>
        touch ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y),
      // Drags are real touch sequences through Chromium's input pipeline; the specs that drag run
      // on the phone project only.
      drag: (path, stepMs, options = {}) => {
        if (!touch) throw new Error("a drag needs a touch screen: run it on site-phone");
        return touchPath(page, path, stepMs, options.hold ?? false);
      },
    });
  },
  player: async ({ page, finger }, use) => {
    await use(new PlayerPage(page, finger));
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

export function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export class PlayerPage {
  constructor(
    readonly page: Page,
    readonly finger: Finger,
  ) {}

  async open(path: string = SITE.path): Promise<void> {
    await this.page.goto(path, { waitUntil: "networkidle" });
    // The islands hydrate when the browser is idle.
    await this.page.waitForFunction(() => document.querySelector("astro-island[ssr]") === null);
    await expect(this.root).toHaveAttribute("data-mini", "hidden");
  }

  get root() {
    return this.page.locator("html");
  }

  /**
   * The hero button, which the player drives from [data-play-digest]. On an older briefing or an
   * episode the floating Play button carries it too, so the hero scopes it.
   */
  get cta() {
    return this.page.locator(".hero [data-play-digest]");
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

  /** The expanded player's page, while the surface (page and bar) is a dialog. */
  get dialog() {
    return this.page.locator('[data-player-surface][role="dialog"] [data-player-page]');
  }

  /** The page element itself, present whether or not it is expanded. */
  get sheet() {
    return this.page.locator("[data-player-page]");
  }

  get closeButton() {
    // The focus-only pill: no close glyph shows at any width.
    return this.page.getByRole("button", { name: "Close the player" }).first();
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
    const p = await this.sheet.evaluate((sheet) =>
      Number.parseFloat(getComputedStyle(sheet).getPropertyValue("--p")),
    );
    return Number.isFinite(p) ? p : 0;
  }

  /** Follows a client-side link to another page; the islands and the narration carry over. */
  async goToNextPage(): Promise<void> {
    const link = this.page.getByRole("link", { name: SITE.nextLink }).first();
    // From the keyboard, so nothing that floats over the link can take the press.
    await link.focus();
    await this.page.keyboard.press("Enter");
    await expect(this.page).toHaveURL(SITE.nextUrl);
  }

  /** Opens the Generate sheet the way a person does: More on the briefing, then Regenerate. */
  async openGenerate(): Promise<Locator> {
    await this.finger.press(this.page.getByRole("button", { name: "More actions" }));
    await this.finger.press(this.page.getByRole("menuitem", { name: "Regenerate" }));
    const dialog = this.page.getByRole("dialog", { name: "Regenerate" });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  /** The stories in narration order, from the page's own digest data, with their place in seconds. */
  stories(): Promise<Array<{ id: string; start: number; end: number }>> {
    return this.page.evaluate(() => {
      const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
      return (data.items as Array<{ id: string; start_ms: number; end_ms: number }>).map(
        (item) => ({ id: item.id, start: item.start_ms / 1000, end: item.end_ms / 1000 }),
      );
    });
  }
}

export { expect };

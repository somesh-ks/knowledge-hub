import { test as base, expect, type Page } from "@playwright/test";

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

declare global {
  interface Window {
    __audios: HTMLAudioElement[];
  }
}

/**
 * Records every Audio object the page creates, so a test can read the real element. The player
 * keeps it out of the DOM on purpose, so there is no selector to find it by.
 */
export const test = base.extend<{ lab: LabPage; audio: AudioProbe }>({
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
    expect(problems).toEqual([]);
  },
  lab: async ({ page }, use) => {
    await use(new LabPage(page));
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

export interface Point {
  x: number;
  y: number;
}

/**
 * Drives a real touch gesture through the browser's input pipeline, so pointer events, pointer
 * capture and velocity all behave as they do under a finger. `stepMs` sets the speed: a flick
 * is a few milliseconds per step, a slow drag tens.
 */
export async function touchDrag(
  page: Page,
  path: Point[],
  stepMs: number,
  options: { hold?: boolean } = {},
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
  if (!options.hold) await release();
  return { release };
}

/** Points along a straight line, `count` of them, ending exactly on `to`. */
export function line(from: Point, to: Point, count: number): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / count,
    y: from.y + ((to.y - from.y) * index) / count,
  }));
}

export class LabPage {
  constructor(readonly page: Page) {}

  async open(path = "/dev/player-lab"): Promise<void> {
    await this.page.goto(path, { waitUntil: "networkidle" });
    // The islands hydrate when the browser is idle.
    await this.page.waitForFunction(() => document.querySelector("astro-island[ssr]") === null);
    await expect(this.page.locator("html")).toHaveAttribute("data-mini", "hidden");
  }

  /** The hero button, which the player drives from [data-play-digest]. */
  get cta() {
    return this.page.locator("[data-play-digest]");
  }

  get mini() {
    return this.page.locator(".mini");
  }

  get panel() {
    return this.page.locator(".player-panel");
  }

  async play(): Promise<void> {
    await this.cta.tap();
    await expect(this.page.locator("html")).toHaveAttribute("data-player-state", "playing");
    // The bar slides up over 300ms; a gesture aimed at it needs it in place.
    await expect(this.mini).toHaveCSS("transform", "none");
  }

  async openPlayer(): Promise<void> {
    await this.page.locator(".mini-open").tap();
    await expect(this.page.locator("html")).toHaveAttribute("data-player", "open");
    await this.settled();
  }

  /** Waits for the sheet's spring to come to rest at fully open. */
  async settled(): Promise<void> {
    await expect
      .poll(() =>
        this.page.locator(".player-panel").evaluate((panel) => panel.hasAttribute("data-moving")),
      )
      .toBe(false);
  }

  async progressOf(): Promise<number> {
    return this.page
      .locator(".rail-fill")
      .evaluate((fill) => Number(fill.style.getPropertyValue("--player-progress")));
  }
}

export { expect };

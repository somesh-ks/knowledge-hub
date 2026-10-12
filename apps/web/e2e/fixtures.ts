import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

/**
 * Every test fails if its page logs an error, throws, or breaks the Content-Security-Policy. The
 * policy is delivered both as a header (vercel.json, applied by the test server) and as a meta
 * element, so a violation here is a violation in production.
 */
export interface Problems {
  messages: string[];
}

interface Options {
  /** Set for a test that goes offline on purpose, where failed requests are expected. */
  allowNetworkErrors: boolean;
}

export const test = base.extend<Options & { problems: Problems }>({
  allowNetworkErrors: [false, { option: true }],
  problems: [
    async ({ page, allowNetworkErrors }, use) => {
      const problems: Problems = { messages: [] };
      // The sources' own icons (https://<host>/favicon.ico) are on invented hosts; a one-pixel image
      // answers them, so the page is not blamed for a network that is not there.
      await page.route("**/api/site-icon**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            "base64",
          ),
        }),
      );
      // A page the test asks for on purpose and that answers 404 logs one console line for itself.
      const expectedNotFound = new Set<string>();
      page.on("response", (response) => {
        if (response.status() === 404 && response.request().isNavigationRequest()) {
          expectedNotFound.add(response.url());
        }
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (expectedNotFound.has(message.location().url)) return;
        // A page without audio asks for its narration shortly after it loads. The static fixture
        // server has no API and answers 501, which the browser logs on the page's behalf. The
        // client takes it as a quiet refusal; this one line is not a problem.
        if (/status of 501/.test(text) && /\/api\/narrate(\?|$)/.test(message.location().url))
          return;
        const isNetworkNoise =
          /Failed to load resource|net::ERR|Failed to fetch|Error hydrating/.test(text);
        if (allowNetworkErrors && isNetworkNoise) return;
        problems.messages.push(`console: ${text} ${message.location().url}`);
      });
      page.on("pageerror", (error) => problems.messages.push(`pageerror: ${error.message}`));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const holder = window as unknown as { __csp?: string[] };
          holder.__csp = holder.__csp ?? [];
          holder.__csp.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
        });
      });
      await use(problems);
      const violations = await page
        .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
        .catch(() => []);
      expect([...problems.messages, ...violations.map((v) => `csp: ${v}`)]).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const ROUTES = [
  { name: "home", path: "/" },
  { name: "latest digest", path: "/d/2026-10-07" },
  { name: "digest without audio", path: "/d/2026-10-05" },
  { name: "weekly digest", path: "/d/2026-10-04-weekly" },
  { name: "library", path: "/library" },
  { name: "offline page", path: "/offline" },
  { name: "not found", path: "/does-not-exist" },
] as const;

/** The fixture digest with an audio timeline. */
export const AUDIO_DIGEST = "/d/2026-10-07";

/** The fixture digest whose audio is still being prepared. */
export const SILENT_DIGEST = "/d/2026-10-05";

/**
 * Resolves once the player and sheets islands have hydrated. Until then a tap on a play chip
 * reaches nobody, so a test that plays something waits for this first.
 */
export async function hydrated(page: Page): Promise<void> {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

/**
 * How far a control answers a pointer around its centre, in CSS pixels. A chip is 36px tall and
 * extends its target to 44px with a pseudo-element, which a bounding box does not show; hit testing
 * does. Scrolls the control to the middle of the screen first, clear of the sticky bars.
 */
export async function targetSize(control: Locator): Promise<{ width: number; height: number }> {
  return control.evaluate((node) => {
    node.scrollIntoView({ block: "center", inline: "center" });
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hits = (dx: number, dy: number): boolean => {
      const found = document.elementFromPoint(x + dx, y + dy);
      return found !== null && (found === node || node.contains(found));
    };
    const reach = (dx: number, dy: number): number => {
      let distance = 0;
      while (distance < 60 && hits(dx * (distance + 1), dy * (distance + 1))) distance += 1;
      return distance;
    };
    return { width: reach(-1, 0) + reach(1, 0) + 1, height: reach(0, -1) + reach(0, 1) + 1 };
  });
}

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Axe's WCAG 2.2 AA violations on the page as it is now, one line each. */
export async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
}

/**
 * Scans the page as it stands in the light scheme, then in the dark one, so one set-up covers both.
 * Colours change over a transition, so each scan waits for the finite animations to end first.
 */
export async function expectNoViolationsInEitherScheme(page: Page): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const finite = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().endTime !== Infinity,
        );
      // A second at most: an animation that never ends is not waited for.
      await Promise.race([
        Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    });
    expect(await violations(page), `${scheme} scheme`).toEqual([]);
  }
}

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
      // A new episode's live copy (D105): the static site has no API, and nothing is written yet.
      await page.route("**/api/stream?**", (route) =>
        route.fulfill({ status: 200, json: { status: "waiting", turns: [] } }),
      );
      // The page's own reports (client errors and CSP violations) go to /api/report, which the
      // static site does not have; the API takes them with 204.
      await page.route("**/api/report", (route) => route.fulfill({ status: 204 }));
      // The Costs page draws from /api/costs: a frozen report, split by the breakdown it asks for.
      await page.route("**/api/costs**", (route) =>
        route.fulfill({
          json: costsReport(new URL(route.request().url()).searchParams.get("by") ?? "provider"),
        }),
      );
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

/** One page of each kind the app has, for sweeps that must hold on every page. */
export const SITE_PAGES = [
  "/",
  "/d/2026-10-07",
  "/e/ep-20261007-1930",
  "/library",
  "/create",
  "/settings",
  "/settings/daily",
  "/settings/weekly",
  "/settings/voice",
  "/settings/sounds",
  "/settings/preferences",
  "/settings/blocked-outlets",
  "/settings/topics",
  "/settings/topics/audio_interfaces",
  "/settings/topics/other",
  // Left out until 2026-10-23, so a change to the card tokens reached the Costs card unchecked.
  "/analytics",
];

/**
 * A frozen /api/costs report: two days, two providers on the first, split by the breakdown asked
 * for (`by`), so a split by use loses the providers as the real one does.
 */
export function costsReport(by: string) {
  const day = (date: string, usd: number, split: Record<string, number>) => ({
    bucket: date,
    total: { usd, runs: 1, shared_usd: 0 },
    groups: Object.fromEntries(
      Object.entries(split).map(([key, value]) => [key, { usd: value, runs: 1, shared_usd: 0 }]),
    ),
  });
  const byProvider = by === "provider";
  return {
    time_zone: "Europe/Stockholm",
    prices_as_of: "2026-10-01",
    unconfirmed: ["speechify/*"],
    site: "ok",
    report: {
      buckets: [
        day("2026-10-18", 0.6, byProvider ? { anthropic: 0.4, speechify: 0.2 } : { daily: 0.6 }),
        day("2026-10-20", 0.3, byProvider ? { speechify: 0.3 } : { narration_on_play: 0.3 }),
      ],
      total: { usd: 0.9, runs: 2, shared_usd: 0 },
      per_run_usd: 0.45,
      per_user_usd: 0.9,
      users: 1,
    },
  };
}

/**
 * Seeds storage before the first page of the test loads, and only then: a page saves its own state
 * as it unloads, so storage written from a page and then reloaded can be overwritten by that page.
 * Values are written as given; `Date.now()` in a value is the test's own clock (page.clock).
 */
export async function seedStorage(
  page: Page,
  seed: { local?: Record<string, string>; session?: Record<string, string> },
): Promise<void> {
  await page.addInitScript((data) => {
    if (sessionStorage.getItem("e2e:seeded")) return;
    sessionStorage.setItem("e2e:seeded", "1");
    for (const [key, value] of Object.entries(data.local ?? {})) localStorage.setItem(key, value);
    for (const [key, value] of Object.entries(data.session ?? {}))
      sessionStorage.setItem(key, value);
  }, seed);
}

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

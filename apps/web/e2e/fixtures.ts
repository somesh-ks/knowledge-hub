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
      // The podcast queue asks which runs are going while this browser has one on record: none, unless a
      // test says otherwise (a later route answers first).
      await page.route("**/api/generations", (route) =>
        route.fulfill({ status: 200, json: { generations: [] } }),
      );
      // The Health page draws from /api/health: a frozen answer with a reading of every tone.
      await page.route("**/api/health", (route) => route.fulfill({ json: healthReport() }));
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

/** The podcast queue's dock on a phone: shown while a run is going and for the day after one ended. */
export const queueDock = (page: Page): Locator => page.locator("[data-queue-dock]");

/** What the queue's newest row says under its name: the stage while it goes, when and how once it ended. */
export const queueStatus = (page: Page): Locator =>
  page.locator("[data-queue-dock] [data-queue-status]").first();

/** The dock's head once every run of the day is over and made: its ring has become a check. */
export const queueComplete = (page: Page): Locator =>
  page.locator('[data-queue-dock] [data-queue-fold-ring][data-ended="done"]');

/** Opens the dock if it is folded, and gives its Start listening link: a finished run stays in the queue with it. */
export async function startListening(page: Page): Promise<Locator> {
  const toggle = page.locator("[data-queue-toggle]");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return page.locator("[data-queue-dock]").getByRole("link", { name: /^Start listening/ });
}

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
  "/settings/categories",
  "/settings/categories/audio_interfaces",
  "/settings/categories/other",
  // Left out until 2026-10-23, so a change to the card tokens reached the Costs card unchecked.
  "/admin/costs",
  "/admin/health",
  "/admin/coverage",
  // The design catalogue (D189): every shared component on one page, held to the same grid.
  "/design",
];

/** A frozen /api/health answer: a row of each tone, and both devices' speed. */
export function healthReport() {
  const row = (id: string, value: string, detail: string, tone: string) => ({
    id,
    value,
    detail,
    tone,
  });
  return {
    checked_at: "2026-10-22T10:00:00.000Z",
    attention: { count: 2, tone: "bad" },
    tiles: {
      last_briefing: "5 h ago",
      briefing_time: "3.4 min",
      page_load: "1.8 s",
      errors_today: "0",
    },
    rows: [
      row("daily", "5 h ago", "8 stories", "good"),
      row("weekly", "2 d ago", "The last run failed", "bad"),
      row("catch_up", "Never", "No episode made yet", "none"),
      row("narration", "4.6 min", "92% of its 5 min", "good"),
      row("fallbacks", "1", "In the last run", "warn"),
      row("time_daily", "3.4 min", "Last 3.6 min, median of 6 runs", "none"),
      row("time_weekly", "5.3 min", "Last 5.0 min, median of 2 runs", "none"),
      row("lcp.mobile", "1.8 s", "Good, 212 visits", "good"),
      row("inp.mobile", "96 ms", "Good, 180 visits", "good"),
      row("cls.mobile", "0.02", "Good, 212 visits", "good"),
      row("lcp.desktop", "1.1 s", "Too few to judge, 4 visits", "none"),
      row("inp.desktop", "No data", "No visits measured this week", "none"),
      row("cls.desktop", "0.00", "Too few to judge, 4 visits", "none"),
      row("page_errors", "0", "None this week", "good"),
      row("blocked_scripts", "0", "2 this week, most on /", "good"),
      row("server_errors", "0", "None this week", "good"),
      row("timeouts", "0", "None this week", "good"),
      row("job_run", "All passed", "9 runs this week, last 5 h ago", "good"),
      row("job_podcast", "All passed", "3 runs this week, last 1 d ago", "good"),
      row("job_audio", "All passed", "6 runs this week, last 5 h ago", "good"),
      row("job_content", "All passed", "14 runs this week, last 5 h ago", "good"),
      row("job_health", "All passed", "7 runs this week, last 2 h ago", "good"),
      row("sources", "All fetching", "176 fetched this week", "good"),
      row("database", "Answering", "Field data and reports", "good"),
      row("content", "Answering", "Pages read it live", "good"),
    ],
    parts: { content: "ok", database: "ok", github: "ok" },
  };
}

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
 * Wakes the player and sheets islands, as the page's first input would once the browser is idle
 * (scripts/islandWake.ts), without the input's own side effects (the focus ring, a press).
 */
export async function wakeIslands(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as { dispatchAwake?: boolean };
    if (scope.dispatchAwake) return;
    scope.dispatchAwake = true;
    dispatchEvent(new Event("singularity:wake"));
  });
}

/**
 * Resolves once the player and sheets islands have woken and hydrated. They wait for a first input
 * or a start, so a test that reads the bar, a sheet or a toast wakes them first.
 */
export async function hydrated(page: Page): Promise<void> {
  await wakeIslands(page);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await coversSettled(page);
}

/**
 * The woken player draws the page's covers and decodes the large one at idle. A test that goes
 * offline next would cut those loads short and fail on their console errors, so it waits for them.
 */
async function coversSettled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll<HTMLImageElement>("astro-island img")];
    // A lazy image off screen is never fetched, so it is not waited for.
    if (!images.every((image) => image.complete || image.loading === "lazy")) return false;
    const data = document.getElementById("singularity-digest-data")?.textContent;
    const large = data
      ? (JSON.parse(data) as { cover?: { src1024?: string } }).cover?.src1024
      : null;
    return (
      !large || performance.getEntriesByType("resource").some((entry) => entry.name.endsWith(large))
    );
  });
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

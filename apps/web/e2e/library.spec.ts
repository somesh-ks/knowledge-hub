import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const DISCUSSION = "Quiet interfaces and fast latency";
const HEADLINES = "AI headlines";
/** Every card, newest first: the day, then when each was written (the discussion came after the briefing). */
const NEWEST_FIRST = [
  DISCUSSION,
  "Wednesday 7 October",
  HEADLINES,
  "Monday 5 October",
  "Sunday 4 October",
];
/** What each card says under its title, in the same order. */
const REST_FACTS = [
  "Discussion, 5 min",
  "12 stories, 1 min",
  "Headlines, 3 min",
  "8 stories, 3 min",
  "Weekly, 14 stories, 8 min",
];

/** The page script has run: search, filter and sort only work from here. */
async function ready(page: Page): Promise<void> {
  await expect(page.locator("[data-library]")).toHaveAttribute("data-ready", "");
}

/** The titles of the cards on show, in the order they sit in the page. */
async function titles(page: Page): Promise<string[]> {
  return page.locator("[data-card]:not([hidden]) .card-title").allTextContents();
}

/**
 * The status line for a narrowed list. Matched loosely: these tests are about filtering, and one
 * test below pins the wording.
 */
async function narrowedTo(page: Page, shown: number, total: number): Promise<void> {
  await expect(page.getByRole("status")).toHaveText(new RegExp(`^${shown} of ${total} results?$`));
}

const filter = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test.describe("the library", () => {
  test("shows every briefing and episode as a cover card, newest first, with no month headings", async ({
    page,
  }) => {
    await page.goto("/library");
    await expect(page).toHaveTitle("Library, Singularity");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
    await expect(page.locator("[data-card] .card-title")).toHaveText(NEWEST_FIRST);
    // One quiet line each: a briefing's recording length where there is one, the estimate elsewhere;
    // an episode says its format and length.
    await expect(page.locator("[data-card] .card-facts")).toHaveText(REST_FACTS);
    await expect(page.locator("[data-card] .cover")).toHaveCount(5);
    await expect(page.locator("[data-card][data-kind='weekly'] .cover[data-weekly]")).toHaveCount(
      1,
    );
    await expect(page.locator(".cover[data-weekly]")).toHaveCount(1);
    // A grid of covers, not a grouped list: no month headings, nothing to open or close.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(page.locator("details, summary")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("5 results");
  });

  test("offers search, the five filter chips and a sort", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByRole("search", { name: "Library" })).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search briefings, episodes and stories" }),
    ).toBeVisible();
    const chips = page.locator("[data-library-filter]");
    await expect(chips).toHaveText(["All", "Daily", "Weekly", "Custom"]);
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    const sort = page.getByRole("combobox", { name: "Sort" });
    await expect(sort.locator("option")).toHaveText([
      "Newest first",
      "Oldest first",
      "Longest first",
      "Most stories",
    ]);
    await expect(sort).toHaveValue("newest");
  });

  test("opens a briefing from its card", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("link", { name: /Monday 5 October/ }).click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday 5 October");
  });

  test("lays the covers out two across on a phone and in a single row on a desktop", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/library");
    const tops = await page
      .locator("[data-card]")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(tops[1]).toBeCloseTo(tops[0] ?? -1, 0);
    if (isMobile) expect(tops[2] ?? 0).toBeGreaterThan((tops[0] ?? 0) + 50);
    else expect(tops[2]).toBeCloseTo(tops[0] ?? -1, 0);
  });

  test("has a Today link that leads home, for an installed app with no browser back", async ({
    page,
  }) => {
    await page.goto("/library");
    await page.getByRole("link", { name: "Today", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
  });

  test("the old /archive address lands on the library", async ({ page }) => {
    await page.goto("/archive");
    await page.waitForURL(/\/library$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
    await expect(page.locator("[data-card]")).toHaveCount(5);
  });
});

test.describe("library search", () => {
  test("keeps the briefings with a matching story and says why they are there", async ({
    page,
  }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("searchbox").fill("forty minute");
    expect(await titles(page)).toEqual(["Monday 5 October"]);
    // While searching, the line under a card says why it is there.
    await expect(page.locator("[data-card]:not([hidden]) .card-facts")).toHaveText(
      "1 matching story",
    );
    await narrowedTo(page, 1, 5);
  });

  test("matches publishers and ignores case and accents", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("searchbox").fill("SMALL TEAMS");
    expect(await titles(page)).toEqual(["Monday 5 October"]);
    await page.getByRole("searchbox").fill("tap latençy");
    // Two briefings and the discussion, whose second story is about tap latency.
    expect(await titles(page)).toEqual([DISCUSSION, "Monday 5 October", "Sunday 4 October"]);
  });

  test("a query with several briefings keeps them in the chosen order", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("searchbox").fill("gridwork");
    expect(await titles(page)).toEqual(["Monday 5 October", "Sunday 4 October"]);
    await page.getByRole("combobox", { name: "Sort" }).selectOption("oldest");
    expect(await titles(page)).toEqual(["Sunday 4 October", "Monday 5 October"]);
  });

  test("says nothing matches, and Clear search brings every card back", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const input = page.getByRole("searchbox");
    await expect(page.locator("[data-library-empty]")).toBeHidden();
    await input.fill("zzzz nothing");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
    await expect(page.locator("[data-library-empty]")).toBeVisible();
    await expect(page.locator("[data-library-empty]")).toContainText("Nothing matches.");
    await expect(page.getByRole("status")).toHaveText("No results");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(page.locator("[data-library-empty]")).toBeHidden();
    expect(await titles(page)).toEqual(NEWEST_FIRST);
    // The cards say their own facts again, not why they matched.
    await expect(page.locator("[data-card] .card-facts")).toHaveText(REST_FACTS);
    await expect(page.getByRole("status")).toHaveText("5 results");
  });

  test("Clear search also resets the filter", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await filter(page, "Weekly").click();
    await page.getByRole("searchbox").fill("zzzz");
    await expect(page.getByRole("button", { name: "Clear search" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(filter(page, "All")).toHaveAttribute("aria-pressed", "true");
    await expect(filter(page, "Weekly")).toHaveAttribute("aria-pressed", "false");
    expect(await titles(page)).toEqual(NEWEST_FIRST);
  });

  test("Enter in the search field does not reload the page", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.evaluate(() => {
      (window as unknown as { __kept: string }).__kept = "same document";
    });
    const input = page.getByRole("searchbox");
    await input.fill("dither");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/library$/);
    expect(await page.evaluate(() => (window as unknown as { __kept?: string }).__kept)).toBe(
      "same document",
    );
    expect(await titles(page)).toEqual(["Wednesday 7 October", "Sunday 4 October"]);
  });
});

test.describe("library filters and order", () => {
  test("a filter chip keeps one kind of card and is the only one pressed", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const onlyPressed = async (name: string) => {
      await expect(filter(page, name)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-library-filter][aria-pressed='true']")).toHaveCount(1);
    };

    await filter(page, "Weekly").click();
    await onlyPressed("Weekly");
    expect(await titles(page)).toEqual(["Sunday 4 October"]);
    await narrowedTo(page, 1, 5);

    await filter(page, "Daily").click();
    await onlyPressed("Daily");
    expect(await titles(page)).toEqual(["Wednesday 7 October", "Monday 5 October"]);
    await narrowedTo(page, 2, 5);

    // Custom is what was made on request: only that shows, and the status counts it.
    await filter(page, "Custom").click();
    await onlyPressed("Custom");
    expect(await titles(page)).toEqual([DISCUSSION, HEADLINES]);
    await expect(page.locator("[data-card][data-kind='episode']:not([hidden])")).toHaveCount(2);
    await narrowedTo(page, 2, 5);

    await filter(page, "All").click();
    await onlyPressed("All");
    expect(await titles(page)).toEqual(NEWEST_FIRST);
    await expect(page.getByRole("status")).toHaveText("5 results");
  });

  test("a filter and a search narrow together", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("searchbox").fill("dither");
    expect(await titles(page)).toEqual(["Wednesday 7 October", "Sunday 4 October"]);
    await filter(page, "Weekly").click();
    expect(await titles(page)).toEqual(["Sunday 4 October"]);
    await filter(page, "Daily").click();
    expect(await titles(page)).toEqual(["Wednesday 7 October"]);
    // A word only the weekly briefing has, while the filter keeps the weekly out.
    await filter(page, "Custom").click();
    await page.getByRole("searchbox").fill("dither");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("No results");
    await expect(page.locator("[data-library-empty]")).toBeVisible();
  });

  test("the sort reorders the cards, in the page as well as on screen", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const sort = page.getByRole("combobox", { name: "Sort" });
    await sort.selectOption("oldest");
    // Sorted by day. The discussion and the Wednesday briefing share a day: their order is the
    // subject of the test "puts the cards of one day in reverse too" below.
    const oldest = await titles(page);
    expect(oldest.slice(0, 3)).toEqual(["Sunday 4 October", "Monday 5 October", HEADLINES]);
    expect([...oldest.slice(3)].sort()).toEqual([DISCUSSION, "Wednesday 7 October"].sort());
    // The longest recording or estimate first: 8, 5, 3, 3 (the newer of the two first), then 1 minute.
    await sort.selectOption("longest");
    expect(await titles(page)).toEqual([
      "Sunday 4 October",
      DISCUSSION,
      HEADLINES,
      "Monday 5 October",
      "Wednesday 7 October",
    ]);
    // The most stories first: 14, 12, 8, 2, then 1 (an episode's stories are the ones it covers).
    await sort.selectOption("stories");
    expect(await titles(page)).toEqual([
      "Sunday 4 October",
      "Wednesday 7 October",
      "Monday 5 October",
      DISCUSSION,
      HEADLINES,
    ]);
    await sort.selectOption("newest");
    expect(await titles(page)).toEqual(NEWEST_FIRST);
  });
});

test.describe("library episodes", () => {
  test("the Custom chip shows only what was made on request, newest first", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await filter(page, "Custom").click();
    expect(await titles(page)).toEqual([DISCUSSION, HEADLINES]);
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(2);
    await expect(page.locator("[data-card][data-kind='episode']:not([hidden])")).toHaveCount(2);
    await expect(page.locator("[data-card]:not([hidden]) .card-facts")).toHaveText([
      "Discussion, 5 min",
      "Headlines, 3 min",
    ]);
    // A long title is cut at two lines, so one card never stands taller than its neighbours by much.
    const lines = await page
      .locator("[data-card]:not([hidden]) .card-title")
      .evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            node.getBoundingClientRect().height /
            Number.parseFloat(getComputedStyle(node).lineHeight),
        ),
      );
    for (const count of lines) expect(count).toBeLessThanOrEqual(2.1);
  });

  test("the Daily chip leaves episodes and the weekly out", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await filter(page, "Daily").click();
    expect(await titles(page)).toEqual(["Wednesday 7 October", "Monday 5 October"]);
    await expect(page.locator("[data-card][data-kind='episode']:not([hidden])")).toHaveCount(0);
    await expect(page.locator("[data-card][data-kind='weekly']:not([hidden])")).toHaveCount(0);
  });

  test("an episode card links to its own page", async ({ page }) => {
    await page.goto("/library");
    const links = page.locator("[data-card][data-kind='episode'] .card-link");
    await expect(links).toHaveCount(2);
    expect(
      await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))),
    ).toEqual(["/e/ep-20261007-1930", "/e/ep-20261006-0900"]);
    await expect(
      page.locator("[data-card]", { hasText: DISCUSSION }).locator(".card-link"),
    ).toHaveAttribute("href", "/e/ep-20261007-1930");
    await expect(
      page.locator("[data-card]", { hasText: HEADLINES }).locator(".card-link"),
    ).toHaveAttribute("href", "/e/ep-20261006-0900");
    await page.getByRole("link", { name: /AI headlines/ }).click();
    await expect(page).toHaveURL(/\/e\/ep-20261006-0900$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINES);
  });

  test("search finds an episode by title, by its format, by a story it covers and by a publisher", async ({
    page,
  }) => {
    await page.goto("/library");
    await ready(page);
    const input = page.getByRole("searchbox");
    await input.fill("quiet interfaces");
    expect(await titles(page)).toEqual([DISCUSSION]);
    // The same story sits in two briefings too, so all three cards come back, newest first.
    await input.fill("loud detail");
    expect(await titles(page)).toEqual([DISCUSSION, "Monday 5 October", "Sunday 4 October"]);
    // Its format is searchable too, and no briefing has that word on a line.
    await input.fill("discussion");
    expect(await titles(page)).toEqual([DISCUSSION]);
    await input.fill("open model coding");
    expect(await titles(page)).toEqual([HEADLINES]);
    await input.fill("frontier notes");
    expect(await titles(page)).toEqual([HEADLINES]);
  });

  test("puts the cards of one day in reverse too, when the order is oldest first", async ({
    page,
  }) => {
    // The discussion was written after the Wednesday briefing, so newest first lists it first and
    // oldest first lists it last.
    await page.goto("/library");
    await ready(page);
    await page.getByRole("combobox", { name: "Sort" }).selectOption("oldest");
    expect(await titles(page)).toEqual([...NEWEST_FIRST].reverse());
  });

  test("reads 'results' after 'of' when one card is left", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await filter(page, "Weekly").click();
    await expect(page.getByRole("status")).toHaveText("1 of 5 results");
  });
});

test.describe("navigating without reloading", () => {
  test("moves between the reader and the library on the client", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (window as unknown as { __kept: string }).__kept = "same document";
    });
    await expect(page.locator("html")).toHaveAttribute("data-view", "home");
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
    await expect(page.locator("html")).toHaveAttribute("data-view", "library");
    // No full page load happened: the window is the same one.
    expect(await page.evaluate(() => (window as unknown as { __kept?: string }).__kept)).toBe(
      "same document",
    );
    // The page script starts again on the new page.
    await ready(page);
    await page.getByRole("searchbox").fill("forty minute");
    expect(await titles(page)).toEqual(["Monday 5 October"]);
    await page.getByRole("link", { name: "Today", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-view", "home");
    expect(await page.evaluate(() => (window as unknown as { __kept?: string }).__kept)).toBe(
      "same document",
    );
  });

  test("moves focus to the new heading and updates the title", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveTitle("Library, Singularity");
    await expect(page.locator("main h1")).toBeFocused();
  });

  test("keeps the page at the top of the new route", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "See all" }).scrollIntoViewIfNeeded();
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);
  });

  test("works with the browser back button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
  });

  test("marks each navigation with the move it makes", async ({ page }) => {
    await page.goto("/");
    const marks: string[] = [];
    await page.exposeFunction("recordMark", (value: string) => marks.push(value));
    await page.evaluate(() => {
      // The shell's listener was registered first, so it has set the attribute by the time this runs.
      document.addEventListener("astro:before-preparation", () => {
        (window as unknown as { recordMark: (value: string) => void }).recordMark(
          document.documentElement.getAttribute("data-astro-nav") ?? "none",
        );
      });
    });
    await page.getByRole("link", { name: /Monday 5 October/ }).click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveURL(/\/library$/);
    expect(marks).toEqual(["in", "out"]);
  });
});

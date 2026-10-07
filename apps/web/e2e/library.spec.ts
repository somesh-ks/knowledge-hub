import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const NEWEST_FIRST = ["Wednesday 7 October", "Monday 5 October", "Sunday 4 October"];

/** The page script has run: search, filter and sort only work from here. */
async function ready(page: Page): Promise<void> {
  await expect(page.locator("[data-library]")).toHaveAttribute("data-ready", "");
}

/** The titles of the cards on show, in the order they sit in the page. */
async function titles(page: Page): Promise<string[]> {
  return page.locator("[data-card]:not([hidden]) .card-title").allTextContents();
}

const filter = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test.describe("the library", () => {
  test("shows every briefing as a cover card, newest first, with no month headings", async ({
    page,
  }) => {
    await page.goto("/library");
    await expect(page).toHaveTitle("Library, Singularity");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
    await expect(page.locator("[data-card] .card-title")).toHaveText(NEWEST_FIRST);
    // One quiet line each: the recording's own length where there is one, the estimate elsewhere.
    await expect(page.locator("[data-card] .card-facts")).toHaveText([
      "12 stories, 1 min",
      "8 stories, 3 min",
      "Weekly, 14 stories, 8 min",
    ]);
    await expect(page.locator("[data-card] .cover")).toHaveCount(3);
    await expect(page.locator("[data-card][data-kind='weekly'] .cover[data-weekly]")).toHaveCount(
      1,
    );
    await expect(page.locator(".cover[data-weekly]")).toHaveCount(1);
    // A grid of covers, not a grouped list: no month headings, nothing to open or close.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(page.locator("details, summary")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("3 briefings");
  });

  test("offers search, the four filter chips and a sort", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByRole("search", { name: "Library" })).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search briefings and stories" }),
    ).toBeVisible();
    const chips = page.locator("[data-library-filter]");
    await expect(chips).toHaveText(["All", "Daily", "Weekly", "With audio"]);
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
    await expect(page.locator("[data-card]")).toHaveCount(3);
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
    await expect(page.getByRole("status")).toHaveText("1 of 3 briefings");
  });

  test("matches publishers and ignores case and accents", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("searchbox").fill("SMALL TEAMS");
    expect(await titles(page)).toEqual(["Monday 5 October"]);
    await page.getByRole("searchbox").fill("tap latençy");
    expect(await titles(page)).toEqual(["Monday 5 October", "Sunday 4 October"]);
  });

  test("a query with several briefings keeps them in the chosen order", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("searchbox").fill("gridwork");
    expect(await titles(page)).toEqual(["Monday 5 October", "Sunday 4 October"]);
    await page.getByRole("combobox", { name: "Sort" }).selectOption("oldest");
    expect(await titles(page)).toEqual(["Sunday 4 October", "Monday 5 October"]);
  });

  test("says no briefings match, and Clear search brings every card back", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const input = page.getByRole("searchbox");
    await expect(page.locator("[data-library-empty]")).toBeHidden();
    await input.fill("zzzz nothing");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
    await expect(page.locator("[data-library-empty]")).toBeVisible();
    await expect(page.locator("[data-library-empty]")).toContainText("No briefings match");
    await expect(page.getByRole("status")).toHaveText("No briefings match");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(page.locator("[data-library-empty]")).toBeHidden();
    expect(await titles(page)).toEqual(NEWEST_FIRST);
    // The cards say their own facts again, not why they matched.
    await expect(page.locator("[data-card] .card-facts")).toHaveText([
      "12 stories, 1 min",
      "8 stories, 3 min",
      "Weekly, 14 stories, 8 min",
    ]);
    await expect(page.getByRole("status")).toHaveText("3 briefings");
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
  test("a filter chip keeps one kind of briefing and is the only one pressed", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const onlyPressed = async (name: string) => {
      await expect(filter(page, name)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-library-filter][aria-pressed='true']")).toHaveCount(1);
    };

    await filter(page, "Weekly").click();
    await onlyPressed("Weekly");
    expect(await titles(page)).toEqual(["Sunday 4 October"]);
    await expect(page.getByRole("status")).toHaveText("1 of 3 briefings");

    await filter(page, "Daily").click();
    await onlyPressed("Daily");
    expect(await titles(page)).toEqual(["Wednesday 7 October", "Monday 5 October"]);

    await filter(page, "With audio").click();
    await onlyPressed("With audio");
    expect(await titles(page)).toEqual(["Wednesday 7 October"]);

    await filter(page, "All").click();
    await onlyPressed("All");
    expect(await titles(page)).toEqual(NEWEST_FIRST);
    await expect(page.getByRole("status")).toHaveText("3 briefings");
  });

  test("a filter and a search narrow together", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("searchbox").fill("dither");
    expect(await titles(page)).toEqual(["Wednesday 7 October", "Sunday 4 October"]);
    await filter(page, "Weekly").click();
    expect(await titles(page)).toEqual(["Sunday 4 October"]);
    await filter(page, "With audio").click();
    expect(await titles(page)).toEqual(["Wednesday 7 October"]);
    await page.getByRole("searchbox").fill("gridwork");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("No briefings match");
    await expect(page.locator("[data-library-empty]")).toBeVisible();
  });

  test("the sort reorders the cards, in the page as well as on screen", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const sort = page.getByRole("combobox", { name: "Sort" });
    await sort.selectOption("oldest");
    expect(await titles(page)).toEqual([...NEWEST_FIRST].reverse());
    // The longest recording or estimate first: 8, 3, then 1 minute.
    await sort.selectOption("longest");
    expect(await titles(page)).toEqual([
      "Sunday 4 October",
      "Monday 5 October",
      "Wednesday 7 October",
    ]);
    // The most stories first: 14, 12, then 8.
    await sort.selectOption("stories");
    expect(await titles(page)).toEqual([
      "Sunday 4 October",
      "Wednesday 7 October",
      "Monday 5 October",
    ]);
    await sort.selectOption("newest");
    expect(await titles(page)).toEqual(NEWEST_FIRST);
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

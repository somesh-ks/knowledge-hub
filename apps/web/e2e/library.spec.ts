import type { Page } from "@playwright/test";
import { expect, hydrated, seedStorage, test } from "./fixtures";

const DISCUSSION = "Quiet interfaces and fast latency";
const HEADLINES = "AI headlines";
/** Every card, newest first: the day, then when each was written (the discussion came after the podcast). */
const NEWEST_FIRST = [
  "Wednesday 7 October",
  DISCUSSION,
  HEADLINES,
  "Monday 5 October",
  "Sunday 4 October",
];
/** What each card says under its title, in the same order. */
const REST_FACTS = [
  "Daily · 12 stories · 1 min",
  "Catch up · 5 min",
  "Catch up · 3 min",
  "Daily · 8 stories · 3 min",
  "Weekly · 14 stories · 8 min",
];

/** The page script has run: search, filter and sort only work from here. */
async function ready(page: Page): Promise<void> {
  await expect(page.locator("[data-library]")).toHaveAttribute("data-ready", "");
}

/** The titles of the cards on show, in the order they sit in the page. */
async function titles(page: Page): Promise<string[]> {
  // A date title joins its day and month with a non-breaking space; compare it as plain words.
  const texts = await page.locator("[data-card]:not([hidden]) .card-title").allTextContents();
  return texts.map((text) => text.replace(/\u00a0/g, " "));
}

/**
 * The status line for a narrowed list. Matched loosely: these tests are about filtering, and one
 * test below pins the wording.
 */
async function narrowedTo(page: Page, shown: number, total: number): Promise<void> {
  await expect(page.locator("[data-library-status]")).toHaveText(
    new RegExp(`^${shown} of ${total} results?$`),
  );
}

/** The kind chips: one group named Show, a checkbox each, at most one ticked. */
const show = (page: Page) => page.getByRole("group", { name: "Show" });
const chipOf = (page: Page, name: string) => show(page).getByRole("checkbox", { name });
/** Ticks the chip of that name, or with "All" unticks the one that is ticked. */
const filter = async (page: Page, name: string) => {
  if (name === "All") {
    const ticked = show(page).locator(".filter-chip:has(input:checked)");
    if ((await ticked.count()) > 0) await ticked.first().click();
    await expect(show(page).locator("input:checked")).toHaveCount(0);
    return;
  }
  const chip = chipOf(page, name);
  if (!(await chip.isChecked()))
    await show(page).locator(".filter-chip", { hasText: name }).click();
  await expect(chip).toBeChecked();
};
/** The filter the chips say: the ticked chip's value, or "all" with none ticked. */
const shown = (page: Page) =>
  show(page)
    .locator("input:checked")
    .evaluateAll(
      (nodes) => (nodes as HTMLInputElement[]).map((node) => node.value).join(" ") || "all",
    );

test.describe("the library", () => {
  test("shows every podcast and episode as a cover card, newest first, with no month headings in the gallery", async ({
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
    // A grid of covers, not a grouped list: the month headings are the list's alone (below), and
    // there is nothing to open or close.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(page.locator("details, summary")).toHaveCount(0);
    await expect(page.locator("[data-library-status]")).toHaveText("5 results");
  });

  test("opens a podcast from its card", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("link", { name: /Monday 5 October/ }).click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday 5 October");
  });

  test("lays the covers out two across on a phone and in a single row on a desktop", {
    tag: "@both",
  }, async ({ page, isMobile }) => {
    await page.goto("/library");
    const tops = await page
      .locator("[data-card]")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(tops[1]).toBeCloseTo(tops[0] ?? -1, 0);
    if (isMobile) expect(tops[2] ?? 0).toBeGreaterThan((tops[0] ?? 0) + 50);
    else expect(tops[2]).toBeCloseTo(tops[0] ?? -1, 0);
  });

  test("the old /archive address lands on the library", async ({ page }) => {
    await page.goto("/archive");
    await page.waitForURL(/\/library$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Library");
    await expect(page.locator("[data-card]")).toHaveCount(5);
  });
});

for (const width of [360, 390]) {
  test(`the Library gallery keeps each card's facts on one line at ${width}px`, async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("singularity:played:2026-10-07", "1"));
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/library");
    await ready(page);
    await expect(page.locator(".card-facts[data-played]")).toHaveCount(1);
    const lines = await page.locator("[data-card] .card-facts").evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent,
        lines: Math.round(
          node.getBoundingClientRect().height /
            Number.parseFloat(getComputedStyle(node).lineHeight),
        ),
      })),
    );
    for (const line of lines) expect(line.lines, line.text ?? "").toBe(1);
  });
}

for (const width of [360, 390]) {
  test(`the shelf on Today keeps each card's facts on one line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const lines = await page.locator(".shelf .card-facts").evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent,
        lines: Math.round(
          node.getBoundingClientRect().height /
            Number.parseFloat(getComputedStyle(node).lineHeight),
        ),
      })),
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.lines, line.text ?? "").toBe(1);
  });
}

test.describe("library search", () => {
  test("keeps the podcasts with a matching story and says why they are there", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("searchbox").fill("forty minute");
    expect(await titles(page)).toEqual(["Monday 5 October"]);
    // While searching, a line under the card names the story that matched, the query's words
    // marked, and the card's own facts (kind, length) stay.
    const match = page.locator("[data-card]:not([hidden]) .card-match");
    await expect(match).toHaveText("A forty minute conversation on taste in small teams");
    await expect(match.locator("b")).toHaveText(["forty", "minute"]);
    await expect(page.locator("[data-card]:not([hidden]) .card-facts")).toHaveText(/^Daily · /);
    await narrowedTo(page, 1, 5);
    // Clearing the search takes the line away.
    await page.getByRole("searchbox").fill("");
    await expect(page.locator(".card-match")).toHaveCount(0);
  });

  test("says nothing matches, and Clear search brings every card back", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const input = page.getByRole("searchbox");
    await expect(page.locator("[data-library-empty]")).toBeHidden();
    await input.fill("zzzz nothing");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
    await expect(page.locator("[data-library-empty]")).toBeVisible();
    await expect(page.locator("[data-library-empty]")).toContainText(
      "No results for \u201czzzz nothing\u201d",
    );
    await expect(page.locator("[data-library-status]")).toHaveText("No results");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(page.locator("[data-library-empty]")).toBeHidden();
    expect(await titles(page)).toEqual(NEWEST_FIRST);
    // The cards say their own facts again, not why they matched.
    await expect(page.locator("[data-card] .card-facts")).toHaveText(REST_FACTS);
    await expect(page.locator("[data-library-status]")).toHaveText("5 results");
  });

  test("a clear button shows for every pointer while the field has text, and returns focus to it", async ({
    page,
  }) => {
    await page.goto("/library");
    await ready(page);
    const clear = page.getByRole("button", { name: "Clear text" });
    const input = page.getByRole("searchbox");
    await expect(clear).toBeHidden();
    await input.fill("gridwork");
    await expect(clear).toBeVisible();
    const box = await clear.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
    await clear.click();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(clear).toBeHidden();
  });

  test("with a filter on, the empty state names both, and Show all resets both", async ({
    page,
  }) => {
    await page.goto("/library");
    await ready(page);
    await filter(page, "Weekly");
    await page.getByRole("searchbox").fill("zzzz");
    await expect(page.locator("[data-library-empty]")).toContainText(
      "No results for \u201czzzz\u201d in weekly podcasts",
    );
    await page.getByRole("button", { name: "Show all" }).click();
    await expect.poll(() => shown(page)).toBe("all");
    await expect(page.getByRole("searchbox")).toHaveValue("");
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
    // The query is in the address (replaceState), but the document is the same one.
    await expect(page).toHaveURL(/\/library\?q=dither$/);
    expect(await page.evaluate(() => (window as unknown as { __kept?: string }).__kept)).toBe(
      "same document",
    );
    expect(await titles(page)).toEqual(["Wednesday 7 October", "Sunday 4 October"]);
  });
});

test.describe("a cover that cannot be fetched", () => {
  // The refusal is the point: the browser logs each cover it could not load.
  test.use({ allowNetworkErrors: true });

  test("shows its palette, not the browser's broken-image glyph", async ({ page }) => {
    await page.route("**/covers/**", (route) => route.abort("internetdisconnected"));
    await page.goto("/library");
    await ready(page);
    const covers = page.locator("[data-card] .cover-image");
    await expect(covers.first()).toBeAttached();
    // Every one that failed is hidden, so the cover's own colour shows.
    await expect
      .poll(async () =>
        covers.evaluateAll((all) => all.filter((each) => !(each as HTMLElement).hidden).length),
      )
      .toBe(0);
  });
});

test.describe("library fixes", () => {
  test("search, filters and the view still work after a run, which leaves its line on every page", async ({
    page,
  }) => {
    // A finished run, as one started on another page leaves it: its line has a link to the Library.
    await page.addInitScript(() =>
      sessionStorage.setItem("singularity:run", JSON.stringify({ id: 5, phase: "done" })),
    );
    await page.goto("/");
    await hydrated(page);
    await page.getByRole("link", { name: "Library", exact: true }).first().click();
    await expect(page).toHaveURL(/\/library$/);
    await ready(page);
    expect(await page.locator("[data-library]").count()).toBe(1);
    await page.getByRole("searchbox").fill("forty minute");
    expect(await titles(page)).toEqual(["Monday 5 October"]);
    await narrowedTo(page, 1, 5);
    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.locator("[data-library]")).toHaveAttribute("data-view", "list");
  });

  test("a focused card is painted whole, so its ring shows", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.locator(".view-btn[data-library-view='list']").focus();
    await page.keyboard.press("Tab");
    const link = page.locator("[data-card] .card-link").first();
    await expect(link).toBeFocused();
    const style = await link.evaluate((node) => {
      const card = node.closest("[data-card]") as HTMLElement;
      return {
        visibility: getComputedStyle(card).contentVisibility,
        outline: getComputedStyle(node).outlineStyle,
      };
    });
    expect(style).toEqual({ visibility: "visible", outline: "solid" });
  });

  test("a list row is never clipped, so its hover tile shows whole", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("singularity:library-view", "list"));
    await page.goto("/library");
    await ready(page);
    const visibility = await page
      .locator("[data-card]")
      .first()
      .evaluate((node) => getComputedStyle(node).contentVisibility);
    expect(visibility).toBe("visible");
  });

  test("an episode deleted on this device stays gone after a new order", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "singularity:deleted-episodes",
        JSON.stringify([{ id: "ep-20261006-0900", at: Date.now() }]),
      ),
    );
    await page.goto("/library");
    await ready(page);
    await expect(page.locator("[data-card]")).toHaveCount(4);
    await page.getByRole("combobox", { name: "Sort" }).selectOption("oldest");
    await expect(page.locator("[data-card]")).toHaveCount(4);
    expect(await titles(page)).not.toContain(HEADLINES);
    await expect(page.locator("[data-library-status]")).toHaveText("4 results");
    await filter(page, "Catch up");
    expect(await titles(page)).toEqual([DISCUSSION]);
  });

  test("keeps the search, the filter and the order in the address, and restores them", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await filter(page, "Daily");
    await page.getByRole("combobox", { name: "Sort" }).selectOption("oldest");
    await page.getByRole("searchbox").fill("gridwork");
    await expect(page).toHaveURL(/\/library\?/);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "gridwork",
      show: "daily",
      sort: "oldest",
    });
    await page.goto(url.pathname + url.search);
    await ready(page);
    await expect(page.getByRole("searchbox")).toHaveValue("gridwork");
    await expect.poll(() => shown(page)).toBe("daily");
    expect(await titles(page)).toEqual(["Monday 5 October"]);
  });

  test("a filter or an order that is not the default looks chosen", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const chip = show(page).locator(".filter-chip", { hasText: "Weekly" });
    const fill = () => chip.evaluate((node) => getComputedStyle(node).backgroundColor);
    const before = await fill();
    await filter(page, "Weekly");
    await expect.poll(fill).not.toBe(before);
    await filter(page, "All");
    // Off the chip, so its hover layer does not count.
    await page.mouse.move(0, 0);
    await expect.poll(fill).toBe(before);
    // The order is a value chip: chosen, it takes the accent container.
    const order = page.locator(".library-bar [data-select]");
    await expect(order).not.toHaveAttribute("data-active", "");
    await page.getByRole("combobox", { name: "Sort" }).selectOption("oldest");
    await expect(order).toHaveAttribute("data-active", "");
  });

  test("a finished item says Played, and a half-heard one shows its bar", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("singularity:played:2026-10-07", "1");
      localStorage.setItem("singularity:resume:2026-10-05", "60");
    });
    await page.goto("/library");
    await ready(page);
    // Played takes the length's place in the facts line, so it never wraps onto its own line.
    const played = page.locator("[data-card][data-id='2026-10-07'] .card-facts");
    await expect(played).toHaveText(/ · Played$/);
    await expect(played).not.toContainText("min");
    await expect(page.locator(".card-facts[data-played]")).toHaveCount(1);
    await expect(
      page.locator("[data-card][data-id='2026-10-05'] [data-cover-progress]"),
    ).toBeVisible();
    // Neither state changes the card's height: the bar lies over the cover, and every card's title
    // starts the same distance under its cover and its facts stay one line.
    const gaps = await page.locator("[data-card]:not([hidden])").evaluateAll((cards) =>
      cards.map((card) => {
        const cover = card.querySelector(".cover")?.getBoundingClientRect();
        const title = card.querySelector(".card-title")?.getBoundingClientRect();
        const facts = card.querySelector(".card-facts")?.getBoundingClientRect();
        return {
          gap: Math.round((title?.top ?? 0) - (cover?.bottom ?? 0)),
          facts: Math.round(facts?.height ?? 0),
        };
      }),
    );
    expect(new Set(gaps.map((card) => card.gap)).size, JSON.stringify(gaps)).toBe(1);
    expect(new Set(gaps.map((card) => card.facts)).size, JSON.stringify(gaps)).toBe(1);
  });

  test("a finished episode keeps its kind and only the length gives way to Played", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("singularity:played:ep-20261007-1930", "1");
    });
    await page.goto("/library");
    await ready(page);
    const facts = page.locator("[data-card][data-id='ep-20261007-1930'] .card-facts");
    await expect(facts).toHaveText("Catch up · Played");
    // Heard again from the start: the mark goes and the length comes back, with the kind.
    await page.evaluate(() => {
      localStorage.removeItem("singularity:played:ep-20261007-1930");
      window.dispatchEvent(new Event("pageshow"));
    });
    await expect(facts).toHaveText("Catch up · 5 min");
  });
});

test.describe("library filters and order", () => {
  test("the type filter keeps one kind of card and shows its choice", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    // Single-select: the chip just ticked is the only one ticked.
    const onlyPressed = async (name: string) => {
      await expect.poll(() => shown(page)).toBe(name.toLowerCase());
    };

    await filter(page, "Weekly");
    await onlyPressed("Weekly");
    expect(await titles(page)).toEqual(["Sunday 4 October"]);
    await narrowedTo(page, 1, 5);

    await filter(page, "Daily");
    await onlyPressed("Daily");
    expect(await titles(page)).toEqual(["Wednesday 7 October", "Monday 5 October"]);
    await narrowedTo(page, 2, 5);

    // Catch up is what was made on request: only that shows, and the status counts it.
    await filter(page, "Catch up");
    await onlyPressed("custom");
    expect(await titles(page)).toEqual([DISCUSSION, HEADLINES]);
    await expect(page.locator("[data-card][data-kind='episode']:not([hidden])")).toHaveCount(2);
    await narrowedTo(page, 2, 5);

    // Pressing the ticked chip again shows everything, with Space as well as a press.
    await chipOf(page, "Catch up").focus();
    await page.keyboard.press("Space");
    await onlyPressed("All");
    expect(await titles(page)).toEqual(NEWEST_FIRST);
    await page.keyboard.press("Space");
    await onlyPressed("custom");
    await filter(page, "All");
    await onlyPressed("All");
    await expect(page.locator("[data-library-status]")).toHaveText("5 results");
  });

  test("a filter and a search narrow together", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("searchbox").fill("dither");
    expect(await titles(page)).toEqual(["Wednesday 7 October", "Sunday 4 October"]);
    await filter(page, "Weekly");
    expect(await titles(page)).toEqual(["Sunday 4 October"]);
    await filter(page, "Daily");
    expect(await titles(page)).toEqual(["Wednesday 7 October"]);
    // A word only the weekly briefing has, while the filter keeps the weekly out.
    await filter(page, "Catch up");
    await page.getByRole("searchbox").fill("dither");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
    await expect(page.locator("[data-library-status]")).toHaveText("No results");
    await expect(page.locator("[data-library-empty]")).toBeVisible();
  });

  test("a phone offers no order, and one left in a link does not reorder the list unseen", async ({
    page,
  }) => {
    await page.goto("/library?sort=oldest");
    await ready(page);
    await expect(page.getByRole("combobox", { name: "Sort" })).toBeHidden();
    expect(await titles(page)).toEqual(NEWEST_FIRST);
  });

  test("the sort reorders the cards, in the page as well as on screen", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const sort = page.getByRole("combobox", { name: "Sort" });
    await sort.selectOption("oldest");
    // Sorted by day. The discussion and the Wednesday briefing share a day: their order within it
    // is library.test.ts's to check.
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
    // An address from before keeps working: an order the page no longer offers is the default.
    await page.goto("/library?sort=stories");
    await expect(sort).toHaveValue("newest");
    await expect(page).not.toHaveURL(/sort=/);
    await sort.selectOption("newest");
    expect(await titles(page)).toEqual(NEWEST_FIRST);
  });
});

test.describe("library episodes", () => {
  test("search also reads an episode's script, which no card shows", async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    const input = page.getByRole("searchbox", { name: "Search your library" });
    await expect(input).toHaveAttribute("placeholder", "Search your library");
    // "fraction" is said in a script and written nowhere on a card.
    await input.fill("fraction cost");
    await expect.poll(() => titles(page)).toEqual([HEADLINES]);
    // The text that matched is an episode's script, so the line says the episode, not a story.
    await expect(page.locator("[data-card]:not([hidden]) .card-match")).toHaveText([
      "Mentioned in the episode",
    ]);
    // Every word has to be there, so one that is not takes the card away again.
    await input.fill("fraction zebra");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
  });

  test("a title the card cuts short carries the whole title as a tooltip, and a short one none", async ({
    page,
  }) => {
    await page.goto("/library");
    await ready(page);
    const long = "A title that runs on and on, well past the two lines a card allows, to prove it";
    await page.evaluate((text) => {
      const title = document.querySelector("[data-card] .card-title");
      if (title) title.textContent = text;
      window.dispatchEvent(new Event("resize"));
    }, long);
    const links = page.locator("[data-card]:not([hidden]) .card-link");
    await expect(links.first()).toHaveAttribute("title", long);
    await expect(links.nth(1)).not.toHaveAttribute("title", /.+/);
  });

  test("a switch chooses between the gallery and a list, and the choice is remembered", async ({
    page,
  }) => {
    await page.goto("/library");
    await ready(page);
    const gallery = page.getByRole("button", { name: "Gallery view" });
    const list = page.getByRole("button", { name: "List view" });
    await expect(gallery).toHaveAttribute("aria-pressed", "true");
    const grid = page.locator("[data-library-grid]");
    await expect(grid).toHaveCSS("display", "grid");
    for (const button of [gallery, list]) {
      // The button is as tall as the selects beside it; a 44px target reaches past it (::after).
      const reach = await button.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        const x = rect.left + rect.width / 2;
        const hits = (px: number, py: number) => {
          const hit = document.elementFromPoint(px, py);
          return hit !== null && node.contains(hit);
        };
        return hits(x, y - 21) && hits(x, y + 21);
      });
      expect(reach).toBe(true);
    }
    await list.click();
    await expect(list).toHaveAttribute("aria-pressed", "true");
    await expect(gallery).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-library]")).toHaveAttribute("data-view", "list");
    await expect(grid).toHaveCSS("display", "block");
    // Rows: each card is as wide as the column, with the same one facts line as the gallery.
    const first = page.locator("[data-card]:not([hidden])").first();
    await expect(first.locator(".card-facts")).toBeVisible();
    // Search, filters and sort still work in the list.
    await page.getByRole("searchbox").fill("quiet interfaces");
    expect(await titles(page)).toEqual([DISCUSSION]);
    await page.getByRole("searchbox").fill("");
    await page.reload();
    await ready(page);
    await expect(page.locator("[data-library]")).toHaveAttribute("data-view", "list");
    await page.getByRole("button", { name: "Gallery view" }).click();
    await expect(grid).toHaveCSS("display", "grid");
  });

  test("a list's month label sits as far under the filters as a gallery cover, and holds under the app bar as the list scrolls", async ({
    page,
  }) => {
    await page.goto("/library");
    await ready(page);
    // How far the thing sits under the filter chips.
    const under = (selector: string) =>
      page.evaluate((target) => {
        const chips = document.querySelector(".library-filters")?.getBoundingClientRect().bottom;
        const node = [...document.querySelectorAll(target)].find(
          (item) => item.getClientRects().length,
        );
        return chips === undefined || !node ? NaN : node.getBoundingClientRect().top - chips;
      }, selector);
    const gallery = await under("[data-card] .cover");
    await page.getByRole("button", { name: "List view" }).click();
    // The list began a row's inset further down than the gallery did.
    expect(await under(".library-month-head")).toBeCloseTo(gallery, 0);

    // A short screen, so the list scrolls: the label stays right under the app bar, which slides
    // away as the page is read and comes back, and the label follows it either way.
    await page.setViewportSize({ width: 390, height: 420 });
    const gap = () =>
      page.evaluate(() => {
        const head = document.querySelector(".library-month-head")?.getBoundingClientRect();
        const bar = document.querySelector(".app-bar")?.getBoundingClientRect();
        return head && bar ? head.top - bar.bottom : NaN;
      });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(gap).toBeCloseTo(0, 0);
    await page.evaluate(() => window.scrollBy(0, -120));
    await expect.poll(gap).toBeCloseTo(0, 0);
  });

  test("in a list the months head a date order, and the rows run two across only where there is room", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.goto("/library");
    await ready(page);
    await page.getByRole("button", { name: "List view" }).click();
    // The empty state has an h2 of its own, so the months are told apart by their class.
    const months = page.locator(".library-month-head:visible");
    const month = months.filter({ hasText: "October 2026" });
    await expect(month).toHaveCount(1);
    const sort = page.getByRole("combobox", { name: "Sort" });
    await sort.selectOption("oldest");
    await expect(month).toHaveCount(1);
    // By length the same month would come back again and again.
    await sort.selectOption("longest");
    await expect(months).toHaveCount(0);
    await sort.selectOption("newest");
    // A search with no match leaves no month standing over nothing.
    await page.getByRole("searchbox").fill("zzzzqqqq");
    await expect(months).toHaveCount(0);
    await page.getByRole("searchbox").fill("");

    const covers = page.locator("[data-card] .cover");
    const place = async () => {
      const [first, second] = await Promise.all([
        covers.nth(0).boundingBox(),
        covers.nth(1).boundingBox(),
      ]);
      return { sideBySide: Math.abs((first?.y ?? 0) - (second?.y ?? 0)) < 2 };
    };
    await page.setViewportSize({ width: 1280, height: 900 });
    expect((await place()).sideBySide).toBe(true);
    // Under 80rem the column is 592px, too narrow for two: one column.
    await page.setViewportSize({ width: 1100, height: 900 });
    expect((await place()).sideBySide).toBe(false);
  });

  test("in a list a match line adds no room above the title, and a bar stays on its cover", async ({
    page,
  }) => {
    await seedStorage(page, { local: { "singularity:resume:ep-20261007-1930": "100" } });
    await page.goto("/library");
    await ready(page);
    await page.getByRole("button", { name: "List view" }).click();
    await page.getByRole("searchbox").fill("latency");
    await expect(page.locator("[data-card]:not([hidden]) .card-match").first()).toBeVisible();
    const rows = await page.locator("[data-card]:not([hidden])").evaluateAll((cards) =>
      cards.map((card) => {
        const linkElement = card.querySelector(".card-link");
        const link = linkElement?.getBoundingClientRect();
        const padding = linkElement
          ? Number.parseFloat(getComputedStyle(linkElement).paddingTop)
          : 0;
        const title = card.querySelector(".card-title")?.getBoundingClientRect();
        const cover = card.querySelector(".cover")?.getBoundingClientRect();
        const bar = card.querySelector<HTMLElement>(".card-progress");
        const box = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
        return {
          // What sits above the title beyond the row's own padding (half-leading aside).
          above: Math.round((title?.top ?? 0) - (link?.top ?? 0) - padding),
          barOnCover: box && cover ? box.bottom <= cover.bottom + 1 && box.top >= cover.top : null,
        };
      }),
    );
    // The row's padding is all there is above a title, with a match line or without one.
    for (const row of rows) expect(row.above).toBeLessThanOrEqual(2);
    expect(rows.some((row) => row.barOnCover === true)).toBe(true);
    expect(rows.every((row) => row.barOnCover !== false)).toBe(true);
  });

  test("a saved list is drawn from the first frame, on a load and on a move from Today", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("singularity:library-view", "list");
      // Each frame that shows a card notes the view it drew the cards in.
      const views: string[] = [];
      (window as unknown as { __views: string[] }).__views = views;
      const tick = () => {
        const library = document.querySelector<HTMLElement>("[data-library]");
        if (library?.querySelector("[data-card]")) views.push(library.dataset.view ?? "gallery");
        if (views.length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // The page's own scripts arrive late, as on a slow connection.
    await page.route("**/_astro/*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    const views = () => page.evaluate(() => (window as unknown as { __views: string[] }).__views);
    await page.goto("/library");
    await ready(page);
    expect((await views()).length).toBeGreaterThan(0);
    expect(new Set(await views())).toEqual(new Set(["list"]));
    await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // A move from Today, once its scripts run, is a swap in the same document.
    await page.goto("/");
    await hydrated(page);
    await page.evaluate(() => {
      (window as unknown as { kept?: boolean }).kept = true;
    });
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library" })
      .click();
    await expect(page).toHaveURL(/\/library$/);
    await ready(page);
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    expect((await views()).length).toBeGreaterThan(0);
    expect(new Set(await views())).toEqual(new Set(["list"]));
  });

  test("search falls back to the cards when the index cannot be fetched", async ({ page }) => {
    await page.route("**/search-index.json", (route) =>
      route.fulfill({ status: 200, body: "not an index" }),
    );
    await page.goto("/library");
    await ready(page);
    const input = page.getByRole("searchbox");
    await input.fill("frontier notes");
    expect(await titles(page)).toEqual([HEADLINES]);
    await input.fill("fraction cost");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
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
    await page.getByRole("link", { name: "Latest", exact: true }).click();
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
});

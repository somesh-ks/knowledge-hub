import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, Route } from "@playwright/test";
import { configHash } from "../src/lib/configHash";
import { GAP_MS } from "../src/scripts/managePageSave";
import { BUILT_FILES, routeConfigServer, routeConfigStore } from "./configServer";
import { expect, test } from "./fixtures";

const LIST = "/settings/categories";
const CRAFT_PAGE = "/settings/categories/design";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// A one-pixel PNG, so the sources' icons load in a browser that is not online.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const SAVED = "Saved.";
const ADDED = "Added. Read from the next update.";

interface Sent {
  op: Record<string, unknown> | Record<string, unknown>[];
}

const PREVIEW = {
  url: "https://newsroom.example/",
  name: "Newsroom Example",
  host: "newsroom.example",
  favicon_url: null,
  thumbnail_url: null,
  feed_url: "https://newsroom.example/feed.xml",
  kind: "feed",
  latest_at: "2026-10-07T08:00:00.000Z",
  items_30d: 12,
  score: 2.5,
  score_label: "Good",
  score_parts: { health: 1, quality: 0.62, trust: 0.88 },
  reason: "Quality is the weakest part: 3 of 12 judged items published.",
};

/** Opens a topic card's More menu and presses one of its items. */
async function pick(page: Page, topic: string, item: string) {
  await page.getByRole("button", { name: `More actions for ${topic}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function setup(
  page: Page,
  answers: Array<{ status: number; body: object }> = [],
  /** Holds every save's answer until it resolves, to see the page while a request is out. */
  hold?: Promise<void>,
) {
  const sent: Sent[] = [];
  await page.route("**/api/site-icon**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
  );
  // Jev's pick of a new topic's emoji; the static test server has no such route.
  await page.route("**/api/topic-emoji**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"emoji":"🎨"}' }),
  );
  await page.route("**/api/config", async (route: Route) => {
    sent.push(route.request().postDataJSON() as Sent);
    const answer = answers.shift() ?? { status: 202, body: { status: 202, run_id: 1 } };
    await hold;
    await route.fulfill({
      status: answer.status,
      contentType: "application/json",
      body: JSON.stringify(answer.body),
    });
  });
  const previews: string[] = [];
  await page.route("**/api/source-preview**", async (route: Route) => {
    previews.push(new URL(route.request().url()).searchParams.get("url") ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PREVIEW),
    });
  });
  return { sent, previews };
}

async function open(page: Page, path = LIST): Promise<void> {
  await page.goto(path);
  await expect(page.locator("[data-topics]")).toHaveAttribute("data-ready", "");
}

/** A source of the topic, not one of the feeds suggested for it. */
const source = (page: Page, name: string) =>
  page.locator("li.source-row:not(.is-suggested)", { hasText: name });
const toast = (page: Page) => page.locator("[data-bar]");
const toastText = (page: Page) => toast(page).locator("[data-bar-text]");
/** A save that went through shows no toast; a screen reader hears it. */
const spoken = (page: Page) => page.locator("[data-live]");
const ops = (sent: Sent[]) => sent.flatMap((item) => [item.op].flat());
/** A removal waits five seconds with Undo before it is sent. */
const AFTER_UNDO = { timeout: 10_000 };

test.describe("the Topics list", () => {
  test("has one row per topic, each with what it holds now, and no source rows until a search", async ({
    page,
  }) => {
    await setup(page);
    await open(page);
    await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a category or a source" })).toBeVisible();
    const rows = [
      ["Design", "2 sources"],
      ["AI", "1 source"],
      ["Technology", "No sources yet"],
      ["Audio interfaces", "1 source"],
      ["World", "3 sources"],
      ["Science", "1 source"],
      ["Sports", "No sources yet"],
    ] as const;
    for (const [name, hint] of rows) {
      await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toContainText(hint);
    }
    await expect(page.locator("li.source-row:visible")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Show sources with score" })).toHaveCount(0);
    await expect(page.getByText("Top picks")).toHaveCount(0);
    // No Other list (2026-10-21).
    await expect(page.getByRole("link", { name: /^Other/ })).toHaveCount(0);
  });

  test("a search narrows every source to a flat list, a topic's format chip narrows its own, and a reload or Back keeps them", async ({
    page,
  }) => {
    await setup(page);
    await open(page);
    // The index is a search and nothing else: no format or status filters.
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search sources" }).fill("studio");
    // The topic list gives way to the sources that match, which open and edit as on a topic page.
    await expect(page.getByRole("link", { name: /^Design/ })).toBeHidden();
    const row = page.locator("li.source-row:visible");
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Edit Studio Notes" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit source" });
    await expect(sheet.getByRole("combobox", { name: "Type" })).toHaveValue("blog");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    // Leaving for a topic and coming Back, and a reload, find the same search.
    await page.goto(CRAFT_PAGE);
    await page.goBack();
    for (const again of [false, true]) {
      if (again) await page.reload();
      await expect(page.getByRole("searchbox", { name: "Search sources" })).toHaveValue("studio");
      await expect(page.locator("li.source-row:visible")).toHaveCount(1);
    }
    // Nothing matching says so and offers Clear, which brings the topics back.
    await page.getByRole("searchbox", { name: "Search sources" }).fill("zzzz");
    await expect(page.getByText("No sources match.")).toBeVisible();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByRole("link", { name: /^Design/ })).toBeVisible();
    // A topic's page: a format chip narrows its list and is kept on a reload.
    await page.goto(CRAFT_PAGE);
    await page.locator("label.filter-chip", { hasText: "Blog" }).click();
    await expect(page.locator("ul[data-sources] li.source-row:visible")).toHaveText([
      /Studio Notes/,
    ]);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Blog" })).toBeChecked();
    await expect(page.locator("ul[data-sources] li.source-row:visible")).toHaveCount(1);
  });

  test("@desktop a topic's formats are chips with no All, any number at once, and Add source sits beside the search", async ({
    page,
  }) => {
    await page.goto(CRAFT_PAGE);
    await expect(page.getByRole("button", { name: "All", exact: true })).toHaveCount(0);
    await expect(
      page.locator(".filter-row").getByRole("button", { name: /^Add source to/ }),
    ).toBeVisible();
    const all = page.locator("ul[data-sources] li.source-row:visible");
    const every = await all.count();
    await page.locator("label.filter-chip", { hasText: "Blog" }).click();
    await expect(all).toHaveCount(1);
    await page.locator("label.filter-chip", { hasText: "News" }).click();
    await expect(page.getByRole("checkbox", { name: "Blog" })).toBeChecked();
    await expect(all.count()).resolves.toBeGreaterThan(1);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "News" })).toBeChecked();
    await page.locator("label.filter-chip", { hasText: "Blog" }).click();
    await page.locator("label.filter-chip", { hasText: "News" }).click();
    await expect(all).toHaveCount(every);
  });

  test("lists every topic in one list by name, with no Other, and the panel offers them in the same order", async ({
    page,
  }) => {
    await setup(page);
    await open(page);
    const names = await page.locator(".topics-index .settings-label").allTextContents();
    expect(names).toEqual([
      "AI",
      "Audio interfaces",
      "Business",
      "Culture",
      "Design",
      "Science",
      "Sports",
      "Technology",
      "World",
    ]);
    await expect(page.getByRole("heading", { level: 2, name: "General news" })).toHaveCount(0);
    await page.getByRole("button", { name: "Add a category or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a category" });
    await sheet.getByRole("tab", { name: "Source" }).click();
    const options = await page
      .getByRole("dialog", { name: "Add a source" })
      .getByRole("combobox", { name: "Category" })
      .locator("option")
      .allTextContents();
    expect(options).toEqual([
      "AI",
      "Audio interfaces",
      "Business",
      "Culture",
      "Design",
      "Science",
      "Sports",
      "Technology",
      "World",
    ]);
  });

  test("a row leads to the topic's page", async ({ page }) => {
    await setup(page);
    await open(page);
    await page.getByRole("link", { name: /^Design/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Design" })).toBeVisible();
    await expect(source(page, "Studio Notes")).toBeVisible();
  });

  test("Add opens one panel on Topic; its Source segment files a source under a topic", async ({
    page,
  }) => {
    const { sent, previews } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a category or a source" }).click();
    await expect(page.getByRole("dialog", { name: "Add a category" })).toBeVisible();
    await page.getByRole("tab", { name: "Source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a source" });
    await expect(sheet).toBeVisible();
    const add = sheet.getByRole("button", { name: "Add source", exact: true });
    await expect(add).toBeDisabled();
    await sheet.getByLabel("Site or feed address").fill("newsroom.example");
    await expect(sheet.getByText("Newsroom Example")).toBeVisible();
    await expect(sheet.getByText("https://newsroom.example/feed.xml")).toBeVisible();
    await expect(sheet.getByText("12 posts")).toBeVisible();
    await expect(sheet.getByText("Good")).toBeVisible();
    await expect(add).toBeEnabled();
    // The same address again is not looked up again.
    await sheet.getByLabel("Site or feed address").fill("");
    await sheet.getByLabel("Site or feed address").fill("newsroom.example");
    await expect(add).toBeEnabled();
    expect(previews).toEqual(["https://newsroom.example/"]);
    await sheet.getByRole("combobox", { name: "Category" }).selectOption("audio_interfaces");
    await add.click();
    await expect(sheet).toBeHidden();
    const row = page.locator("[data-added] li.source-row").first();
    await expect(row).toContainText("Newsroom Example");
    await expect(row).toContainText(ADDED);
    expect(ops(sent)).toEqual([
      {
        op: "source.add",
        url: "https://newsroom.example/",
        topic_ids: ["audio_interfaces"],
        format: "blog",
        id: expect.stringMatching(/^newsroom-example-/),
      },
    ]);
  });

  test("a new topic is a row at once, saved once with Jev's emoji, and opens its page before the build", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    let answer: () => void = () => {};
    const jev = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.route("**/api/topic-emoji**", async (route: Route) => {
      await jev;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"emoji":"🧪"}' });
    });
    await open(page);
    await page.getByRole("button", { name: "Add a category or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a category" });
    const form = sheet.getByRole("form", { name: "Add a category" });
    // Its name, what counts and where it plays (D71): no keywords and no sources step.
    await expect(form.getByLabel(/Keywords/)).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Next" })).toHaveCount(0);
    const add = sheet.getByRole("button", { name: "Add category", exact: true });
    // Add refuses details that are missing, beside the field.
    await add.click();
    await expect(form.getByText("Enter a name.")).toBeVisible();
    await expect(form.getByLabel("Name")).toBeFocused();
    // A name a topic already has is refused, whatever its case.
    await form.getByLabel("Name").fill("design");
    await add.click();
    await expect(form.getByText("You already have a category called Design.")).toBeVisible();
    await form.getByLabel("Name").fill("Motion design");
    await form
      .getByLabel("What should count as this category")
      .fill("Animation and motion in interfaces.");
    await add.click();
    await expect(sheet).toBeHidden();
    // Listed at once as a row like the others, in its place by name, with a guessed emoji (D142).
    await expect(page).toHaveURL(LIST);
    const row = page.locator(".topics-index > a.row-action", { hasText: "Motion design" });
    await expect(row).toContainText("No sources yet");
    const names = await page
      .locator(".topics-index > a.row-action .settings-label")
      .allTextContents();
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })),
    );
    await expect(row.locator(".topic-emoji")).not.toHaveText("");
    await expect(row.locator(".topic-emoji")).not.toHaveText("🧪");
    // Its one save waits for Jev's emoji, which then takes the guess's place.
    expect(sent).toHaveLength(0);
    answer();
    await expect(row.locator(".topic-emoji")).toHaveText("🧪");
    await expect.poll(() => sent.length).toBe(1);
    expect(ops(sent)).toEqual([
      {
        op: "topic.upsert",
        topic: {
          id: "motion-design",
          name: "Motion design",
          description: "Animation and motion in interfaces.",
          weight: 0.7,
          enabled: true,
          keywords: [],
          section_id: "motion-design",
          emoji: "🧪",
        },
      },
    ]);
    // Suggested sources are a topic page's, never the list's.
    await expect(page.getByRole("heading", { name: "Suggested sources" })).toHaveCount(0);
    // Its row opens its page before the build, drawn as a built topic's, with its suggestions.
    await row.click();
    await expect(page).toHaveURL(/\/settings\/categories\/new\?id=motion-design$/);
    await expect(page.locator("[data-topics]")).toHaveAttribute("data-ready", "");
    await expect(page.locator("#page-title")).toHaveText("Motion design");
    await expect(page.getByText("No sources yet")).toBeVisible();
    const suggested = page.getByRole("list", { name: "Suggested sources for Motion design" });
    await expect(suggested.getByRole("button", { name: "Add Motion Weekly" })).toBeVisible();
    await expect(page.getByText("__shell_")).toHaveCount(0);
    expect(sent).toHaveLength(1);
  });

  test("a new topic's page before the build adds a suggested source, and both stay on a reload", async ({
    page,
  }) => {
    await page.clock.install();
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a category or a source" }).click();
    const form = page
      .getByRole("dialog", { name: "Add a category" })
      .getByRole("form", { name: "Add a category" });
    const sheet = page.getByRole("dialog", { name: "Add a category" });
    await form.getByLabel("Name").fill("Motion design");
    await form
      .getByLabel("What should count as this category")
      .fill("Animation and motion in interfaces.");
    await sheet.getByRole("button", { name: "Add category", exact: true }).click();
    // Opened at once, whether or not its save has gone yet.
    await page.locator(".topics-index > a.row-action", { hasText: "Motion design" }).click();
    await expect(page.locator("[data-topics]")).toHaveAttribute("data-ready", "");
    await expect(page.locator("#page-title")).toHaveText("Motion design");
    await page.getByRole("button", { name: "Add Motion Weekly" }).click();
    await page.clock.runFor(GAP_MS);
    await expect
      .poll(() => ops(sent))
      .toContainEqual({
        op: "source.add",
        url: "https://motion-weekly.example/rss.xml",
        topic_ids: ["motion-design"],
        id: expect.stringMatching(/^motion-weekly-example-/),
      });
    expect(ops(sent).filter((op) => op.op === "topic.upsert")).toHaveLength(1);
    await expect(spoken(page)).toHaveText(SAVED);
    const before = sent.length;

    await page.reload();
    await expect(page.locator("[data-topics]")).toHaveAttribute("data-ready", "");
    await expect(page.locator("#page-title")).toHaveText("Motion design");
    await expect(page.getByRole("button", { name: "Added Motion Weekly" })).toBeDisabled();
    // The list counts the source it will have once the build lands.
    await open(page);
    await expect(
      page.locator(".topics-index > a.row-action", { hasText: "Motion design" }),
    ).toContainText("1 source");
    await page.clock.runFor(GAP_MS);
    expect(sent.length).toBe(before);
  });

  test("a refused detail keeps what was typed and sends nothing", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a category or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a category" });
    const form = sheet.getByRole("form", { name: "Add a category" });
    await form.getByLabel("Name").fill("Motion design");
    await sheet.getByRole("button", { name: "Add category", exact: true }).click();
    await expect(form.getByText("Say what should count as this category.")).toBeVisible();
    await expect(form.getByLabel("What should count as this category")).toBeFocused();
    await expect(form.getByLabel("Name")).toHaveValue("Motion design");
    // Typing clears the note.
    await form.getByLabel("What should count as this category").fill("Animation.");
    await expect(form.getByText("Say what should count as this category.")).toBeHidden();
    await expect(sheet).toBeVisible();
    expect(sent).toHaveLength(0);
  });

  test("a topic cannot take the address of the Other page", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a category or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a category" });
    const form = sheet.getByRole("form", { name: "Add a category" });
    await form.getByLabel("Name").fill("Other");
    await form.getByLabel("What should count as this category").fill("Anything else.");
    await sheet.getByRole("button", { name: "Add category", exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(ops(sent)).toMatchObject([{ op: "topic.upsert", topic: { id: "other-2" } }]);
  });
});

test.describe("a topic's page", () => {
  // Design gathers the fixture's Design engineering craft and Product design (D69).
  const CRAFT = "/settings/categories/design";

  test("a weight change on Preferences saves itself as one weights.set, and a reload keeps the view", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/categories/audio_interfaces");
    await page.getByRole("tab", { name: "Preferences" }).click();
    await expect(page).toHaveURL(/\?view=preferences$/);
    const slider = page.locator("[data-weight]");
    await slider.fill("3");
    await expect(page.locator(".topic-weight:has([data-weight]) [data-word]")).toHaveText("More");
    await expect(spoken(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([{ op: "weights.set", weights: { audio_interfaces: 0.85 } }]);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Preferences" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("[data-weight]")).toHaveValue("3");
    // The view is a tablist: Home goes back to Sources, and the address follows.
    await page.getByRole("tab", { name: "Preferences" }).press("Home");
    await expect(page.getByRole("tab", { name: "Sources" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Sources" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page).not.toHaveURL(/view=/);
    await expect(page.getByRole("tabpanel", { name: "Sources" })).toBeVisible();
  });

  test("a type set on Preferences goes as one mix.set for every topic and holds after a reload", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/preferences");
    await expect(page.getByRole("slider")).toHaveCount(7);
    await page.getByRole("slider", { name: "Video", exact: true }).fill("0");
    await expect(spoken(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([{ op: "mix.set", format_mix: { video: 0 } }]);
    await page.reload();
    await expect(page.getByRole("slider", { name: "Video", exact: true })).toHaveValue("0");
  });

  test("Design weighs each topic it gathers by name; a group of one has a plain Weight row", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const weights = page.getByRole("region", { name: "Category weightage" });
    // Shown on Preferences, not with the sources.
    await expect(weights.getByRole("slider")).toHaveCount(0);
    await page.getByRole("tab", { name: "Preferences" }).click();
    await expect(weights.getByRole("slider")).toHaveCount(2);
    await expect(weights.getByRole("slider").first()).toHaveAccessibleName(
      "Design engineering craft",
    );
    await weights.getByRole("slider", { name: "Product design" }).fill("1");
    await expect(spoken(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([{ op: "weights.set", weights: { product_design: 0.5 } }]);
    // A Preferences load never shows the sources first: probed every frame from the first paint.
    await page.addInitScript(() => {
      const w = window as unknown as { sourcesFlashed?: boolean };
      w.sourcesFlashed = false;
      const shown = (selector: string) =>
        document.querySelector(selector)?.checkVisibility({ visibilityProperty: true }) ?? false;
      const probe = () => {
        if (shown("[data-weight]")) return;
        if (shown("[data-sources]")) w.sourcesFlashed = true;
        requestAnimationFrame(probe);
      };
      new MutationObserver(() => {
        if (!shown("[data-weight]") && shown("[data-sources]")) w.sourcesFlashed = true;
      }).observe(document, { childList: true, subtree: true, attributes: true });
      requestAnimationFrame(probe);
    });
    await open(page, "/settings/categories/ai?view=preferences");
    await expect(page.locator("[data-weight]")).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { sourcesFlashed: boolean }).sourcesFlashed),
    ).toBe(false);
    const single = page.getByRole("region", { name: "Category weightage" });
    await expect(single.getByRole("slider", { name: "Weight", exact: true })).toHaveCount(1);
  });

  test("Listen in is a list to tick: unticking Daily leaves every topic Design gathers out of it", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const field = page.getByRole("button", { name: /^Listen in/ });
    await expect(field).toHaveText("All podcasts");
    await field.click();
    const list = page.getByRole("listbox", { name: "Listen in" });
    await expect(list).toBeVisible();
    await list.getByRole("option", { name: "Daily" }).click();
    await expect(field).toHaveText("Weekly and Catch up");
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(field).toBeFocused();
    await expect(spoken(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([
      { op: "topic.scope", ids: ["design_engineering_craft", "product_design"], daily: false },
    ]);
  });

  test("a source's row opens it to edit, and a new name is sent and shows at once", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    await source(page, "Studio Notes").getByRole("button", { name: "Edit Studio Notes" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit source" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("tablist", { name: "What to add" })).toBeHidden();
    const name = sheet.getByRole("textbox", { name: "Name" });
    await expect(name).toHaveValue("Studio Notes");
    // Editing starts with reading: focus stays in the panel, off the field, so no keyboard comes up.
    await expect(name).not.toBeFocused();
    expect(await sheet.evaluate((panel) => panel.contains(document.activeElement))).toBe(true);
    await expect(sheet.getByRole("combobox", { name: "Category" })).toHaveValue(
      "design_engineering_craft",
    );
    await expect(
      sheet.getByRole("link", { name: "Open Studio Notes in a new tab" }),
    ).toHaveAttribute("href", "https://www.studio-notes.example/");
    const save = sheet.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await name.fill("Studio Notes Weekly");
    await save.click();
    await expect(sheet).toBeHidden();
    await expect(source(page, "Studio Notes Weekly")).toBeVisible();
    await expect
      .poll(() => ops(sent))
      .toEqual([{ op: "source.update", id: "studio-notes", name: "Studio Notes Weekly" }]);
  });

  // A favorite that did not reach the store, or a panel that forgot it, leaves its posts filtered
  // out before the judge with nothing on screen to say so (YouTube, 2026-10-24).
  test("a favorite changed in the panel is sent, and the panel still says so when opened again", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const edit = source(page, "Studio Notes").getByRole("button", { name: "Edit Studio Notes" });
    const sheet = page.getByRole("dialog", { name: "Edit source" });
    const favorite = sheet.getByRole("checkbox", { name: "Favorite source" });
    await edit.click();
    // The fixture ships Studio Notes as high signal.
    await expect(favorite).toBeChecked();
    await favorite.uncheck();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect
      .poll(() => ops(sent))
      .toEqual([{ op: "source.update", id: "studio-notes", high_signal: false }]);
    await edit.click();
    await expect(favorite).not.toBeChecked();
  });

  test("every source has a checkbox: unticking turns it off and ticking turns it back on", async ({
    page,
  }) => {
    await page.clock.install();
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const row = source(page, "Studio Notes");
    const box = row.getByRole("checkbox", { name: "Read Studio Notes" });
    await expect(box).toBeChecked();
    // The score stays on an off row, which stays in its place.
    await expect(row.locator(".score")).toBeVisible();
    await box.uncheck();
    await expect.poll(() => ops(sent).length).toBe(1);
    await expect(row).toBeVisible();
    await expect(row.locator(".score")).toBeVisible();
    await box.check();
    // The second edit waits out the server's ten seconds between edits before it is sent.
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => ops(sent).length).toBe(2);
    expect(ops(sent)).toEqual([
      { op: "source.set", id: "studio-notes", enabled: false },
      { op: "source.set", id: "studio-notes", enabled: true },
    ]);
  });

  test.describe("with the config store on", () => {
    // The store going down is on purpose here: the browser logs its 503.
    test.use({ allowNetworkErrors: true });

    // The bug (D149): with the config store on, an edit saved on one device reached no other until
    // a rebuild, and a toggle sent from that stale page put the old value back.
    test("an edit saved on another device shows here without a rebuild, and a store that is down shows what this device last read", async ({
      page,
      context,
      baseURL,
    }) => {
      await page.clock.install();
      const { sent } = await setup(page);
      // On another device: Studio Notes switched off, and Kiln Weekly added under the same topic.
      const user = JSON.parse(BUILT_FILES["config/sources.user.json"] as string);
      user.overrides["studio-notes"] = { ...user.overrides["studio-notes"], enabled: false };
      user.added.push({
        ...user.added[0],
        id: "kiln-weekly",
        name: "Kiln Weekly",
        url: "https://kiln.example/",
        feed_url: "https://kiln.example/feed.xml",
        topic_ids: ["design_engineering_craft"],
      });
      let stored: Record<string, string> | null = {
        "config/sources.user.json": JSON.stringify(user),
      };
      await routeConfigStore(page, () => stored);
      // The page as a build with the store switched on serves it (staticServer.mjs).
      await context.addCookies([
        { name: "test-config-store", value: configHash(BUILT_FILES), url: `${baseURL}/` },
      ]);
      await open(page, CRAFT);
      const box = source(page, "Studio Notes").getByRole("checkbox", { name: "Read Studio Notes" });
      await expect(box).not.toBeChecked();
      await expect(
        source(page, "Kiln Weekly").getByRole("checkbox", { name: "Read Kiln Weekly" }),
      ).toBeChecked();
      // Ticking it here turns it back on: the page starts from what is stored, not from the build.
      await box.check();
      await expect
        .poll(() => ops(sent))
        .toEqual([{ op: "source.set", id: "studio-notes", enabled: true }]);

      // Deleting a row the store drew: it stays gone on a reload, though the store, its edge copy a
      // second old, still lists it.
      const kiln = source(page, "Kiln Weekly");
      await page.getByRole("button", { name: "Edit Kiln Weekly" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete source" }).click();
      await page
        .getByRole("dialog", { name: "Delete Kiln Weekly?" })
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(kiln).toBeHidden();
      await page.clock.runFor(GAP_MS);
      await expect
        .poll(() => ops(sent))
        .toEqual([
          { op: "source.set", id: "studio-notes", enabled: true },
          { op: "source.remove", id: "kiln-weekly" },
        ]);
      await page.reload();
      await expect(page.locator("[data-topics]")).toHaveAttribute("data-ready", "");
      await expect(box).toBeChecked();
      await expect(kiln).toBeHidden();

      // Another device adds Glaze Monthly; this one reads it once, then loses the store (Neon
      // asleep, or offline). The page shows what it last read (D172), not the build, which never
      // had Glaze Monthly, and the local edits still lie over it.
      user.added.push({
        ...user.added[0],
        id: "glaze-monthly",
        name: "Glaze Monthly",
        url: "https://glaze.example/",
        feed_url: "https://glaze.example/feed.xml",
        topic_ids: ["design_engineering_craft"],
      });
      stored = { "config/sources.user.json": JSON.stringify(user) };
      await page.reload();
      await expect(source(page, "Glaze Monthly")).toBeVisible();
      stored = null;
      await page.reload();
      await expect(page.locator("[data-topics]")).toHaveAttribute("data-ready", "");
      await expect(source(page, "Glaze Monthly")).toBeVisible();
      await expect(box).toBeChecked();
      await expect(kiln).toBeHidden();
    });

    // The bug (D173): the Sources page drew what the build had. A source added on another device
    // was missing from the search, a moved one said "Moves to" forever, its new format never
    // showed, the Add panel had no new topic, and a renamed topic's page kept its old name.
    test("the Sources list and a topic's page show every edit the store holds", async ({
      page,
      context,
      baseURL,
    }) => {
      await setup(page);
      const user = JSON.parse(BUILT_FILES["config/sources.user.json"] as string);
      user.overrides["studio-notes"] = {
        ...user.overrides["studio-notes"],
        topic_ids: ["audio_interfaces"],
        format: "podcast",
      };
      user.added.push({
        ...user.added[0],
        id: "kiln-weekly",
        name: "Kiln Weekly",
        url: "https://kiln.example/",
        feed_url: "https://kiln.example/feed.xml",
        topic_ids: ["design_engineering_craft"],
      });
      const topics = JSON.parse(BUILT_FILES["config/topics.json"] as string);
      const audio = topics.topics.find((topic: { id: string }) => topic.id === "audio_interfaces");
      audio.name = "Audio UI";
      topics.topics.push({ ...audio, id: "pottery", name: "Pottery", section_id: "pottery" });
      await routeConfigStore(page, () => ({
        "config/sources.user.json": JSON.stringify(user),
        "config/topics.json": JSON.stringify(topics),
      }));
      await context.addCookies([
        { name: "test-config-store", value: configHash(BUILT_FILES), url: `${baseURL}/` },
      ]);

      await open(page);
      const search = page.locator("[data-filter-q]");
      await search.fill("kiln");
      await expect(source(page, "Kiln Weekly")).toBeVisible();
      await search.fill("studio");
      const studio = source(page, "Studio Notes");
      await expect(studio.locator(".source-kind")).toHaveText(/^Podcast · /);
      await expect(studio).not.toContainText("Moves to");
      await expect(
        page
          .locator("#topics-panel-template")
          .evaluate((template) =>
            [
              ...(template as HTMLTemplateElement).content.querySelectorAll(
                "[data-source-topic] option",
              ),
            ].map((option) => option.textContent),
          ),
      ).resolves.toContain("Pottery");

      await open(page, "/settings/categories/audio_interfaces");
      await expect(page).toHaveTitle(/^Audio UI, /);
      await expect(
        page.getByRole("button", { name: "Add source to Audio UI" }).first(),
      ).toBeAttached();
    });
  });

  test("the search block holds still and the app bar stays while the page scrolls down and back up", async ({
    page,
  }) => {
    // The block sticks under the app bar; a bar that slid away and came back moved it by its
    // height each time (owner, 2026-10-23). The bar is pinned on this page (data-pins-bar).
    // A short screen, so the fixture page scrolls far enough to hold the block stuck at two
    // positions clear of its card's end (at the very end the card's edge pushes the block up).
    await page.setViewportSize({ width: 390, height: 600 });
    await open(page, "/settings/categories/design");
    const block = page.locator(".source-filter[data-chips]");
    // Where the block meets its sticky edge, from its own place and inset: two scroll positions
    // past it, both well inside the card the block sticks within.
    const stickAt = await block.evaluate(
      (el) =>
        el.getBoundingClientRect().top +
        window.scrollY -
        Number.parseFloat(getComputedStyle(el).top),
    );
    const far = Math.round(stickAt + 100);
    const near = Math.round(stickAt + 40);
    await page.evaluate((y) => window.scrollTo(0, y), far);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(far);
    const stuck = await block.boundingBox();
    await page.evaluate((y) => window.scrollTo(0, y), near);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(near);
    await expect.poll(() => block.boundingBox()).toEqual(stuck);
    await expect(page.locator("html")).not.toHaveAttribute("data-bar-hidden", "");
  });

  test("its Add source button opens the panel with the topic chosen", async ({ page }) => {
    await page.clock.install();
    const { sent } = await setup(page);
    await open(page, "/settings/categories/audio_interfaces");
    await page.getByRole("button", { name: "Add source to Audio interfaces" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a source" });
    await expect(sheet.getByRole("combobox", { name: "Category" })).toHaveValue("audio_interfaces");
    // It adds a source to this topic: no switch to a new topic.
    await expect(sheet.getByRole("tab", { name: "Category" })).toBeHidden();
    // It suggests the catalogue's feeds for the topic chosen, and changes them with it.
    await sheet.getByRole("combobox", { name: "Category" }).selectOption({ label: "Design" });
    await expect(sheet.getByRole("button", { name: "Add Pixel Ledger" })).toBeVisible();
    await sheet.getByRole("combobox", { name: "Category" }).selectOption({ label: "Sports" });
    await expect(sheet.getByRole("button", { name: "Add Pixel Ledger" })).toHaveCount(0);
    await sheet.getByRole("combobox", { name: "Category" }).selectOption("audio_interfaces");
    await sheet.getByLabel("Site or feed address").fill("newsroom.example");
    // The feed address ends in an ellipsis rather than breaking mid-word.
    await expect(sheet.locator(".source-facts-url")).toHaveCSS("white-space", "nowrap");
    await sheet.getByRole("button", { name: "Add source", exact: true }).click();
    const row = page.locator("[data-sources] li.source-row").first();
    await expect(row).toContainText("Newsroom Example");
    await expect(row).toContainText(ADDED);
    // It is a row like the others: the address, a rating and the checkbox, ticked, with no tint of
    // its own (it was once a tinted stub that spread over the next row).
    await expect(row.locator(".source-url")).toContainText("newsroom.example");
    await expect(row.locator(".score")).toBeVisible();
    await expect(row.getByRole("checkbox", { name: "Read Newsroom Example" })).toBeChecked();
    expect(await row.evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");
    // The one picture of the list: the new row beside its neighbour, where the tint once spread
    // over the next row. Local only (CI's fonts differ): when topics.css changes, run this spec,
    // read the diff, and update with --update-snapshots after a look.
    if (!process.env.CI) {
      await expect(page.locator("[data-sources]")).toHaveScreenshot("added-source-row.png", {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
    }
    // It is live at once, under the id the add named: untick, tick, then delete it, no reload.
    const added = ops(sent).find((op) => op.op === "source.add")?.id as string;
    const box = row.getByRole("checkbox", { name: "Read Newsroom Example" });
    await box.uncheck();
    await page.clock.runFor(GAP_MS);
    await expect
      .poll(() => ops(sent))
      .toContainEqual({ op: "source.set", id: added, enabled: false });
    await box.check();
    await row.getByRole("button", { name: "Edit Newsroom Example" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete source" }).click();
    await page
      .getByRole("dialog", { name: "Delete Newsroom Example?" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(row).toBeHidden();
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => ops(sent)).toContainEqual({ op: "source.remove", id: added });
  });

  test("removing a custom topic waits with Undo, then goes back to the list without it", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await page.goto("/settings");
    await open(page, "/settings/categories/audio_interfaces");
    await pick(page, "Audio interfaces", "Delete category Audio interfaces");
    // Delete asks first (D103).
    await page
      .getByRole("dialog", { name: "Delete Audio interfaces?" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(toastText(page)).toHaveText("Removing Audio interfaces");
    // Gone from the page at once, before its request goes (D142).
    await expect(page.locator(".topic-gone")).toBeVisible();
    expect(ops(sent)).toEqual([]);
    await expect(page).toHaveURL(/\/settings\/categories$/, AFTER_UNDO);
    await expect(page.locator('a[href="/settings/categories/audio_interfaces"]')).toBeHidden();
    expect(ops(sent)).toEqual([{ op: "topic.remove", id: "audio_interfaces" }]);
    // The list took the removed page's place: Back goes on to where the person came from.
    await page.goBack();
    await expect(page).toHaveURL(/\/settings$/);
    // Opened again before the build, the removed topic's page gives way to the list.
    await page.goto("/settings/categories/audio_interfaces");
    await expect(page).toHaveURL(/\/settings\/categories$/);
  });

  test("a built-in topic cannot be removed", async ({ page }) => {
    await setup(page);
    await open(page, CRAFT);
    await expect(page.getByRole("button", { name: /^Delete category/ })).toHaveCount(0);
  });

  test("a topic that never publishes and one the app no longer lists have no page; their sources are on Other", async ({
    page,
  }) => {
    await setup(page);
    await open(page);
    await expect(page.getByRole("link", { name: /^Venture capital and gossip/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Trending/ })).toHaveCount(0);
    await open(page, "/settings/categories/other");
    await expect(page.locator("li.source-row")).toHaveCount(2);
  });

  test("a general topic: always on, in podcasts, edit, scores, no weight and no remove", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/categories/world");
    await expect(page.getByRole("heading", { level: 1, name: "World" })).toBeVisible();
    await expect(page.locator("[data-weight]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Delete category/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add source to World" })).toBeVisible();
    await expect(source(page, "Meridian Wire").locator(".score")).toBeVisible();
    await expect(source(page, "Quiet Gazette").locator(".score")).toBeVisible();
    await expect(
      source(page, "Quiet Gazette").getByRole("checkbox", { name: "Read Quiet Gazette" }),
    ).not.toBeChecked();
    // What counts is editable, as for Design and Trending.
    await pick(page, "World", "Edit category World");
    const sheet = page.getByRole("dialog", { name: "Edit category" });
    await expect(sheet.getByLabel("What should count as this category")).toBeEditable();
    await page.keyboard.press("Escape");
    // A general topic can be put in or out of each podcast and is always on: a list of podcasts, no switch.
    await expect(page.getByRole("button", { name: /^Listen in/ })).toHaveCount(1);
    await expect(page.getByRole("switch")).toHaveCount(0);
    expect(ops(sent)).toEqual([]);
  });

  test("an off source stays readable, and every name is a 44px target", async ({ page }) => {
    await setup(page);
    for (const path of ["/settings/categories/world", "/settings/categories/other"]) {
      await open(page, path);
      const found = await new AxeBuilder({ page })
        .include("[data-fields]")
        .withRules(["color-contrast", "target-size"])
        .analyze();
      expect(
        found.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" "))}`),
        path,
      ).toEqual([]);
      const heights = await page
        .locator("li.source-row .source-edit")
        .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
      expect(heights.length, path).toBeGreaterThan(0);
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    }
  });

  test("Other lists the sources with no topic, and can turn one back on", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/categories/other");
    await expect(page.getByRole("heading", { level: 1, name: "Other" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Read Quiet Motion" }).check();
    await expect(spoken(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([{ op: "source.set", id: "quiet-motion", enabled: true }]);
  });

  // A source could be turned off but never deleted: no control sent source.remove, on any screen.
  test("a source is deleted from its edit panel after a confirm, gone at once with Undo, and stays gone on a reload", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/categories/other");
    const row = page.locator('li.source-row[data-id="quiet-motion"]');
    const confirm = page.getByRole("dialog", { name: "Delete Quiet Motion?" });
    await page.getByRole("button", { name: "Edit Quiet Motion" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete source" }).click();
    // Cancel keeps the source, and the panel it came from.
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();
    expect(ops(sent)).toEqual([]);
    await page.getByRole("dialog").getByRole("button", { name: "Delete source" }).click();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    // Gone at once; the removal waits behind the scenes with Undo in the toast (D142).
    await expect(row).toBeHidden({ timeout: 1500 });
    await expect(toastText(page)).toHaveText("Removing Quiet Motion");
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(row).toBeVisible();
    expect(ops(sent)).toEqual([]);
    await page.getByRole("button", { name: "Edit Quiet Motion" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete source" }).click();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(row).toBeHidden({ timeout: 1500 });
    await expect
      .poll(() => ops(sent), AFTER_UNDO)
      .toEqual([{ op: "source.remove", id: "quiet-motion" }]);
    // The build has not run: the page opened next still leaves it out.
    await page.reload();
    await open(page, "/settings/categories/other");
    await expect(row).toBeHidden();
  });
});

// The catalogue's feeds that fit a topic are in the page when it is built: no request, no waiting.
test.describe("a topic's suggested sources", () => {
  const DESIGN = "/settings/categories/design";
  const region = (page: Page) => page.getByRole("region", { name: "Suggested sources" });
  /** The suggestions on show; the spares wait hidden in the page. */
  const names = (page: Page) => region(page).locator("li:not([hidden]) .source-name");
  const suggestion = (page: Page, name: string) =>
    page.locator("[data-suggested-sources] li.source-row", { hasText: name });

  test("are the catalogue's feeds that fit the topic, with no score, no pill and nothing waiting", async ({
    page,
  }) => {
    await setup(page);
    await open(page, DESIGN);
    await expect(
      region(page).getByRole("heading", { level: 2, name: "Suggested sources" }),
    ).toBeVisible();
    // No line explains the list: the heading says it.
    await expect(region(page).locator(".manage-quiet")).toHaveCount(0);
    // The five that fit Design and the topics it gathers best, best first. Type and Grid is a sixth,
    // kept hidden as the next one in, and Model Ledger, which the owner reads already, is not offered.
    await expect(names(page)).toHaveText([
      "Pixel Ledger",
      "Motion Weekly",
      "Craft Bench",
      "Agent Patterns",
      "Interface Notes",
    ]);
    // Nothing that claims a score or a filter, and nothing that stands in for a request.
    await expect(
      region(page).locator(".score, .pips, input, [class*='skeleton'], [class*='pill']"),
    ).toHaveCount(0);
    await expect(region(page).getByText(/Jev|Live curated|filtered/)).toHaveCount(0);
    await expect(
      page.locator("[data-suggested-sources] [aria-hidden='true'].source-row"),
    ).toHaveCount(0);
  });

  test("+ adds the feed under the topic in one request; the row waits where it is, then moves to the sources and the next suggestion fills its place", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const { sent } = await setup(
      page,
      [],
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await open(page, DESIGN);
    const row = suggestion(page, "Motion Weekly");
    const top = await row.evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY));
    await row.getByRole("button", { name: "Add Motion Weekly" }).click();
    // While the request is out the row stays put, pressed and busy, and still counts as a suggestion.
    await expect(row.getByRole("button", { name: "Adding Motion Weekly" })).toBeDisabled();
    await expect(row).toHaveAttribute("aria-busy", "true");
    await expect(row).toContainText("Adding");
    expect(await row.evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY))).toBe(
      top,
    );
    await expect(page.locator("[data-sources] li.source-row")).toHaveCount(2);
    release();
    // Saved: it leaves the suggestions for the top of the sources, a source like the others.
    await expect(row).toHaveCount(0);
    const added = page.locator("[data-sources] li.source-row").first();
    await expect(added).toContainText("Motion Weekly");
    await expect(added).toContainText(ADDED);
    await expect(added.getByRole("checkbox", { name: "Read Motion Weekly" })).toBeChecked();
    // The hidden sixth takes its place, so five stay on offer.
    await expect(names(page)).toHaveText([
      "Pixel Ledger",
      "Craft Bench",
      "Agent Patterns",
      "Interface Notes",
      "Type and Grid",
    ]);
    // The row says it, so the toast does not say it again.
    await expect(toast(page)).toBeHidden();
    expect(ops(sent)).toEqual([
      {
        op: "source.add",
        url: "https://motion-weekly.example/rss.xml",
        topic_ids: ["design_engineering_craft"],
        id: expect.stringMatching(/^motion-weekly-example-/),
      },
    ]);
    await expect(page.locator("[data-sources] li.source-row")).toHaveCount(3);
  });

  test("a general topic is offered feeds by its name, and + files the feed under it", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/categories/world");
    await expect(names(page)).toHaveText(["Headline Desk"]);
    await suggestion(page, "Headline Desk")
      .getByRole("button", { name: "Add Headline Desk" })
      .click();
    await expect
      .poll(() => ops(sent))
      .toEqual([
        {
          op: "source.add",
          url: "https://headline-desk.example/rss",
          topic_ids: ["world"],
          id: expect.stringMatching(/^headline-desk-example-/),
        },
      ]);
  });

  test("a page has no such section when nothing fits: Other, Sports and Culture", async ({
    page,
  }) => {
    await setup(page);
    for (const path of [
      "/settings/categories/other",
      "/settings/categories/sports",
      "/settings/categories/culture",
    ]) {
      await open(page, path);
      await expect(page.getByRole("heading", { name: "Suggested sources" }), path).toHaveCount(0);
      await expect(page.locator("[data-suggested-sources], [class*='skeleton']"), path).toHaveCount(
        0,
      );
    }
  });
});

// The browser logs the refused lookup itself; the panel answers it in words.
test.describe("editing a topic", () => {
  test("a topic of the owner's renames in one request, and keeps its keywords", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/categories/audio_interfaces");
    await pick(page, "Audio interfaces", "Edit category Audio interfaces");
    const sheet = page.getByRole("dialog", { name: "Edit category" });
    const form = sheet.getByRole("form", { name: "Edit category" });
    await expect(sheet.getByRole("tablist", { name: "What to add" })).toBeHidden();
    const name = form.getByLabel("Name");
    await expect(name).toHaveValue("Audio interfaces");
    await expect(name).not.toBeFocused();
    // Keywords have no field (D71); the topic keeps the ones it has.
    await expect(form.getByLabel(/Keywords/)).toHaveCount(0);
    await name.fill("Audio and voice");
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Audio and voice");
    await expect
      .poll(() => ops(sent))
      .toMatchObject([
        {
          op: "topic.upsert",
          topic: {
            id: "audio_interfaces",
            name: "Audio and voice",
            description: "Interface work on players, voice and sound.",
            keywords: ["audio", "voice", "player"],
            enabled: true,
            weight: 0.7,
          },
        },
      ]);
    expect(ops(sent)).toHaveLength(1);
  });

  test("the emoji button opens a picker that is searched by keyword and keys, and a pick is one save carrying the emoji", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/categories/audio_interfaces");
    const button = page.getByRole("button", { name: "Change emoji for Audio interfaces" });
    const before = await button.textContent();
    await button.click();
    const picker = page.getByRole("dialog", { name: /emoji/i });
    await expect(picker).toBeVisible();
    // The list comes with the first open, not with the page.
    const search = picker.getByRole("searchbox");
    await search.fill("rocket");
    await expect(picker.locator(".emoji-cell").first()).toHaveAttribute("data-emoji", "🚀");
    await search.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();
    await expect(button).toHaveText("🚀");
    await expect(button).not.toHaveText(before ?? "");
    await expect(button).toBeFocused();
    await expect
      .poll(() => ops(sent))
      .toMatchObject([{ op: "topic.upsert", topic: { id: "audio_interfaces", emoji: "🚀" } }]);
    expect(ops(sent)).toHaveLength(1);
  });

  // Every touch on the picker's grid started a pull, so scrolling back up it closed the sheet.
  test("a phone's emoji grid scrolled down keeps the picker open when it is dragged back up the list", async ({
    page,
  }) => {
    await setup(page);
    await open(page, "/settings/categories/audio_interfaces");
    await page.getByRole("button", { name: "Change emoji for Audio interfaces" }).click();
    const picker = page.getByRole("dialog", { name: /emoji/i });
    await expect(picker.locator(".emoji-cell").first()).toBeVisible();
    const body = picker.locator(".emoji-body");
    await body.evaluate((el) => {
      el.scrollTop = 300;
    });
    const box = (await body.boundingBox()) as { x: number; y: number };
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: box.x + 40, y }],
      });
    await touch("touchStart", box.y + 20);
    for (let step = 1; step <= 6; step++) await touch("touchMove", box.y + 20 + step * 40);
    await touch("touchEnd", box.y + 260);
    await expect(picker).toBeVisible();
    expect(await picker.evaluate((el) => (el as HTMLElement).style.translate)).toBe("");
  });

  test("a new topic sets its scope as it is added, in the same request", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a category or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a category" });
    await sheet
      .getByRole("form", { name: "Add a category" })
      .getByLabel("Name")
      .fill("Spatial audio");
    await sheet.getByLabel("What should count as this category").fill("Spatial audio in apps.");
    // Every podcast ticked reads as it does on every topic page.
    await expect(sheet.getByRole("button", { name: /^Listen in/ })).toHaveText("All podcasts");
    await sheet.getByRole("button", { name: /^Listen in/ }).click();
    await sheet.getByRole("option", { name: "Weekly" }).click();
    await expect(sheet.getByRole("button", { name: /^Listen in/ })).toHaveText(
      "Daily and Catch up",
    );
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Add category", exact: true }).click();
    await expect
      .poll(() => ops(sent))
      .toMatchObject([
        { op: "topic.upsert", topic: { id: "spatial-audio", name: "Spatial audio" } },
        { op: "topic.scope", ids: ["spatial-audio"], weekly: false },
      ]);
  });

  test("Save waits until a detail changed, and putting it back waits again", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/categories/audio_interfaces");
    await pick(page, "Audio interfaces", "Edit category Audio interfaces");
    const sheet = page.getByRole("dialog", { name: "Edit category" });
    const name = sheet.getByRole("form", { name: "Edit category" }).getByLabel("Name");
    const save = sheet.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();
    await name.fill("Audio and voice");
    await expect(save).toBeEnabled();
    await name.fill("Audio interfaces");
    await expect(save).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    expect(sent).toHaveLength(0);
  });
});

test.describe("a refused suggested add", () => {
  // The refusal is the point: the browser logs the 500 it was sent.
  test.use({ allowNetworkErrors: true });
  const DESIGN = "/settings/categories/design";
  const suggestion = (page: Page, name: string) =>
    page.locator("[data-suggested-sources] li.source-row", { hasText: name });

  test("a refused add says so in its row and offers the plus again, and the plus sends it once more", async ({
    page,
  }) => {
    const { sent } = await setup(page, [{ status: 500, body: { status: 500 } }]);
    await open(page, DESIGN);
    const row = suggestion(page, "Motion Weekly");
    await row.getByRole("button", { name: "Add Motion Weekly" }).click();
    // Refused: no check and no "Adding": the row says what happened, with the plus back.
    await expect(row).toContainText("Not added. Try again.");
    const again = row.getByRole("button", { name: "Add Motion Weekly" });
    await expect(again).toBeEnabled();
    await expect(again).not.toHaveClass(/is-added/);
    // Pressed again, it is the same add, not a second one, and it goes through: the source is listed.
    await again.click();
    await expect(source(page, "Motion Weekly")).toContainText(ADDED);
    await expect(row).toHaveCount(0);
    const adds = ops(sent).filter(
      (op) => op.op === "source.add" && String(op.url).includes("motion-weekly"),
    );
    expect(adds).toHaveLength(2);
    expect(adds[1]?.id).toBe(adds[0]?.id);
  });

  test("a refusal left behind by reloading is not shown as saved on the next page", async ({
    page,
  }) => {
    // Refused, and never sent again: the next page must show what the repository holds.
    await setup(page, [{ status: 500, body: { status: 500 } }]);
    await open(page, DESIGN);
    const row = suggestion(page, "Motion Weekly");
    await row.getByRole("button", { name: "Add Motion Weekly" }).click();
    await expect(row).toContainText("Not added. Try again.");
    await page.reload();
    await open(page, DESIGN);
    const again = suggestion(page, "Motion Weekly");
    await expect(again.getByRole("button", { name: "Add Motion Weekly" })).toBeEnabled();
    await expect(again).not.toContainText("Added");
    await expect(page.locator("[data-saved-note]")).toHaveCount(0);
  });
});

test.describe("a refused lookup", () => {
  test.use({ allowNetworkErrors: true });
  test("a source whose site has no icon shows its first letter instead", async ({ page }) => {
    await setup(page);
    await page.route("**/api/site-icon**", (route) => route.fulfill({ status: 404, body: "" }));
    await open(page, "/settings/categories/design_engineering_craft");
    const tile = source(page, "Studio Notes").locator(".source-icon");
    await expect(tile.locator(".source-initial")).toHaveText("S");
    await expect(tile.locator(".source-initial")).toBeVisible();
    await expect(tile.locator("img[data-loaded]")).toHaveCount(0);
  });

  test("the panel says what to do when the address cannot be read", async ({ page }) => {
    await setup(page);
    await page.route("**/api/source-preview**", (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: "unreachable", message: "x" }),
      }),
    );
    await open(page);
    await page.getByRole("button", { name: "Add a category or a source" }).click();
    await page.getByRole("tab", { name: "Source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a source" });
    await sheet.getByLabel("Site or feed address").fill("nothing.example");
    await expect(sheet.locator("#panel-source-url-error")).toContainText("could not be read");
    await expect(sheet.getByLabel("Site or feed address")).toHaveAttribute("aria-invalid", "");
    // No empty card stands in for the message.
    await expect(sheet.locator(".source-card")).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Add source", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});

/** Waits out a dialog's own transitions, so a scan never reads its text halfway through the fade in. */
const settled = (dialog: Locator) =>
  dialog.evaluate((node) =>
    Promise.all(node.getAnimations().map((animation) => animation.finished)),
  );

test("a long feed address never widens the Add source panel past the screen", async ({ page }) => {
  await setup(page);
  const feed = `https://newsroom.example/${"a-very-long-section-name/".repeat(3)}feed.xml`;
  await page.route("**/api/source-preview**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...PREVIEW,
        name: "A newsroom with a name that goes on and on and on",
        feed_url: feed,
      }),
    }),
  );
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  await page.getByRole("button", { name: "Add a category or a source" }).click();
  await page.getByRole("tab", { name: "Source" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a source" });
  await sheet.getByLabel("Site or feed address").fill("newsroom.example");
  await expect(sheet.getByText("A newsroom with a name")).toBeVisible();
  const spill = await sheet.evaluate((node) => {
    const room = node.getBoundingClientRect().right;
    const wide = [...node.querySelectorAll<HTMLElement>("*")]
      .filter((each) => each.getBoundingClientRect().width > 0)
      .filter((each) => each.getBoundingClientRect().right > room + 1)
      .map((each) => each.className || each.tagName);
    return { wide, sideways: node.scrollWidth > node.clientWidth + 1 };
  });
  expect(spill.wide).toEqual([]);
  expect(spill.sideways).toBe(false);
});

test("has no accessibility violations: the list, a topic, and the panel open", async ({ page }) => {
  // Seven full scans: on the phone's slower emulation they need more than the default 30 seconds.
  test.setTimeout(90_000);
  await setup(page);
  const scan = async () =>
    (await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
  await open(page);
  expect(await scan()).toEqual([]);
  await open(page, "/settings/categories/design");
  expect(await scan()).toEqual([]);
  await page.getByRole("button", { name: /^Listen in/ }).click();
  expect(await scan()).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add source to Design" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a source" });
  await sheet.getByLabel("Site or feed address").fill("newsroom.example");
  await expect(sheet.getByText("Newsroom Example")).toBeVisible();
  await settled(sheet);
  expect(await scan()).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await source(page, "Studio Notes").getByRole("button", { name: "Edit Studio Notes" }).click();
  const edit = page.getByRole("dialog", { name: "Edit source" });
  await expect(edit).toBeVisible();
  await settled(edit);
  expect(await scan()).toEqual([]);
  await page.keyboard.press("Escape");
  // Closing gives the panel's history entry back; let that land before the next page is opened.
  await expect(edit).toBeHidden();
  await open(page, "/settings/categories/audio_interfaces");
  await pick(page, "Audio interfaces", "Edit category Audio interfaces");
  const editTopic = page.getByRole("dialog", { name: "Edit category" });
  await expect(editTopic).toBeVisible();
  await settled(editTopic);
  expect(await scan()).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(editTopic).toBeHidden();
  await open(page);
  await page.getByRole("button", { name: "Add a category or a source" }).click();
  const topic = page.getByRole("dialog", { name: "Add a category" });
  await topic
    .getByRole("form", { name: "Add a category" })
    .getByLabel("Name")
    .fill("Motion design");
  // The panel as a refused detail leaves it: the note beside the field, with its alert glyph.
  await topic.getByRole("button", { name: "Add category", exact: true }).click();
  await expect(topic.getByText("Say what should count as this category.")).toBeVisible();
  await settled(topic);
  expect(await scan()).toEqual([]);
});

test.describe("Blocked sources", () => {
  test("a blocked outlet stays listed after a reload, and Undo brings a removal back", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await page.goto(LIST);
    await expect(page.locator("[data-topics]")).toHaveAttribute("data-ready", "");
    await expect(page.getByRole("link", { name: /Blocked sources/ })).toContainText("None");
    await page.getByRole("link", { name: /Blocked sources/ }).click();
    await expect(page.locator("[data-blocked]")).toHaveAttribute("data-ready", "");

    // Block opens the sheet; any address of the outlet works, and the page lists and sends its domain.
    const sheet = page.getByRole("dialog", { name: "Block sources" });
    const sheetField = sheet.getByLabel("Search sources or paste an address");
    await page.getByRole("button", { name: "Block", exact: true }).click();
    await sheetField.fill("not a domain");
    await sheetField.press("Enter");
    await expect(sheet.locator("[data-sheet-error]")).toBeVisible();
    await sheetField.fill("https://www.Example.com/story?id=1");
    await sheetField.press("Enter");
    await sheet.getByRole("button", { name: "Block", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unblock example.com" })).toBeVisible();
    await expect.poll(() => ops(sent)).toEqual([{ op: "profile.block", domain: "example.com" }]);

    // The build has not landed: the saved edit keeps the list right on this page and on the list.
    await page.reload();
    await expect(page.locator("[data-blocked]")).toHaveAttribute("data-ready", "");
    await expect(page.getByRole("button", { name: "Unblock example.com" })).toBeVisible();
    await page.goto(LIST);
    await expect(page.getByRole("link", { name: /Blocked sources/ })).toContainText("1 source");

    await page.goto("/settings/blocked-outlets");
    await expect(page.locator("[data-blocked]")).toHaveAttribute("data-ready", "");
    await page.getByRole("button", { name: "Unblock example.com" }).click();
    await expect(toastText(page)).toHaveText("Removing example.com");
    await expect(page.getByRole("button", { name: "Unblock example.com" })).toBeHidden();
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Unblock example.com" })).toBeVisible();

    await page.getByRole("button", { name: "Unblock example.com" }).click();
    await expect
      .poll(() => ops(sent), AFTER_UNDO)
      .toEqual([
        { op: "profile.block", domain: "example.com" },
        { op: "profile.unblock", domain: "example.com" },
      ]);
    await expect(page.getByText("No blocked sources")).toBeVisible();

    // Blocked again once the unblock has gone: the row was hidden as removing and stayed hidden.
    await page.getByRole("button", { name: "Block", exact: true }).click();
    await sheetField.fill("example.com");
    await sheetField.press("Enter");
    await sheet.getByRole("button", { name: "Block", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unblock example.com" })).toBeVisible();
    await expect(page.getByText("No blocked sources")).toBeHidden();
  });
});

test.describe("the podcast structure", () => {
  // A reorder went out as the whole list, so a move that the server's own schema refused, or one
  // lost on a reload before the build, would leave the next episode in the old order unseen.
  test("a block moved by its menu goes as one structure.set and holds after a reload; its rules and prompt go as one structure.set and one structure.prompt", async ({
    page,
  }) => {
    await page.clock.install();
    const server = await routeConfigServer(page);
    await open(page, "/settings/preferences?view=structure");
    await expect(page.getByRole("tab", { name: "Structure" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const list = page.getByRole("list", { name: "Structure blocks" });
    const names = () => list.locator(".structure-row .settings-label").allTextContents();
    const before = await names();
    // The frames Catch up's model writes stay listed, quiet, at the ends of the one list.
    expect(before.slice(0, 3)).toEqual(["Hello", "Top picks", "Design"]);
    await list.getByRole("button", { name: "More for Design", exact: true }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect(spoken(page)).toHaveText("Design, 3 of " + String(before.length - 2));
    await expect
      .poll(names)
      .toEqual([before[0], before[1], before[3], before[2], ...before.slice(4)]);
    // An edit of the order is the owner's own list: the profile says Custom.
    await expect(page.getByLabel("Profile")).toHaveValue("custom");
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => server.applied.length).toBe(1);
    expect(server.applied[0]).toMatchObject({ op: "structure.set", profile: "custom" });
    const moved = await names();

    await page.reload();
    await expect(page.locator("[data-structure]")).toHaveAttribute("data-mounted", "");
    await expect.poll(names).toEqual(moved);
    // The server takes one edit every ten seconds, and a reloaded page has forgotten when it sent.
    await page.clock.runFor(GAP_MS);

    await list.getByRole("button", { name: "More for Design", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const sheet = page.getByRole("dialog", { name: "Design" });
    await sheet.getByRole("combobox", { name: "Most from one source" }).selectOption("1");
    await sheet.getByText("Writing instructions (advanced)").click();
    const prompt = sheet.getByRole("textbox", { name: "Instructions for the model" });
    await expect(prompt).toHaveValue(/FIELDS/);
    await prompt.fill("Tell each design story in two plain sentences.");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    const design = list
      .locator(".structure-row")
      .filter({ has: page.locator(".settings-label", { hasText: /^Design$/ }) });
    await expect(design).toContainText("1 per source");
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => server.applied.length).toBe(3);
    const set = server.applied[1] as { op: string; blocks: Array<Record<string, unknown>> };
    expect(set.op).toBe("structure.set");
    expect(set.blocks.find((block) => block.id === "design")).toMatchObject({ per_source: 1 });
    expect(server.applied[2]).toEqual({
      op: "structure.prompt",
      key: "section:design",
      prompt: "Tell each design story in two plain sentences.",
    });
    expect(server.statuses).toEqual([202, 202]);
  });
});

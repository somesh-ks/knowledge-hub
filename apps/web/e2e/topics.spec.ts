import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

const LIST = "/settings/topics";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// A one-pixel PNG, so the sources' icons load in a browser that is not online.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const SAVED = "Saved. Live in about a minute.";
const ADDED = "Added. It appears after the next build.";

interface Sent {
  passphrase: string;
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

async function setup(page: Page, answers: Array<{ status: number; body: object }> = []) {
  const sent: Sent[] = [];
  await page.route("**/api/site-icon**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
  );
  await page.route("**/api/config", async (route: Route) => {
    sent.push(route.request().postDataJSON() as Sent);
    const answer = answers.shift() ?? { status: 202, body: { status: 202, run_id: 1 } };
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
const ops = (sent: Sent[]) => sent.flatMap((item) => [item.op].flat());
/** A removal waits five seconds with Undo before it is sent. */
const AFTER_UNDO = { timeout: 10_000 };

test.describe("the Topics list", () => {
  test("has one row per topic, each with what it holds now, and no filters", async ({ page }) => {
    await setup(page);
    await open(page);
    await expect(page.getByRole("heading", { level: 1, name: "Topics & Sources" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a topic or a source" })).toBeVisible();
    const rows = [
      ["Design", "2 sources"],
      ["AI", "1 source"],
      ["Technology", "0 sources"],
      ["Audio interfaces", "Weight 75%, 1 source"],
      ["Other", "2 sources outside the topics above"],
      ["World", "3 sources"],
      ["Science", "1 source"],
      ["Sports", "0 sources"],
    ] as const;
    for (const [name, hint] of rows) {
      await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toContainText(hint);
    }
    await expect(page.locator("li.source-row")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Show sources with score" })).toHaveCount(0);
    await expect(page.getByText("Top picks")).toHaveCount(0);
  });

  test("lists every topic in one list by name, Other last, and the panel offers them in the same order", async ({
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
      "Other",
    ]);
    await expect(page.getByRole("heading", { level: 2, name: "General news" })).toHaveCount(0);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a topic" });
    await sheet.getByRole("radio", { name: "Source" }).check();
    const options = await page
      .getByRole("dialog", { name: "Add a source" })
      .getByRole("combobox", { name: "Topic" })
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
      "Other",
    ]);
  });

  test("a row leads to the topic's page, whose title leads back", async ({ page }) => {
    await setup(page);
    await open(page);
    await page.getByRole("link", { name: /^Design/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Design" })).toBeVisible();
    const crumb = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link");
    await expect(crumb).toHaveText("Topics & Sources");
    await expect(crumb).toHaveAttribute("href", LIST);
    await expect(source(page, "Studio Notes")).toBeVisible();
  });

  test("Add opens one panel on Topic; its Source segment files a source under a topic", async ({
    page,
  }) => {
    const { sent, previews } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    await expect(page.getByRole("dialog", { name: "Add a topic" })).toBeVisible();
    await page.getByRole("radio", { name: "Source" }).check();
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
    await sheet.getByRole("combobox", { name: "Topic" }).selectOption("audio_interfaces");
    await add.click();
    await expect(sheet).toBeHidden();
    const row = page.locator("[data-added] li.source-row.is-new");
    await expect(row).toContainText("Newsroom Example");
    await expect(row).toContainText(ADDED);
    expect(ops(sent)).toEqual([
      { op: "source.add", url: "https://newsroom.example/", topic_ids: ["audio_interfaces"] },
    ]);
  });

  test("a new topic is added in one press and waits in the list, saved, until the build gives it a page", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a topic" });
    const form = sheet.getByRole("form", { name: "Add a topic" });
    // Its name, what counts and where it plays (D71): no keywords and no sources step.
    await expect(form.getByLabel(/Keywords/)).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Next" })).toHaveCount(0);
    const add = sheet.getByRole("button", { name: "Add topic", exact: true });
    // Add refuses details that are missing, beside the field.
    await add.click();
    await expect(form.getByText("Enter a name.")).toBeVisible();
    await expect(form.getByLabel("Name")).toBeFocused();
    await form.getByLabel("Name").fill("Motion design");
    await form
      .getByLabel("What should count as this topic")
      .fill("Animation and motion in interfaces.");
    await add.click();
    await expect(sheet).toBeHidden();
    // The site is static: the topic's page exists after the next build, so the list keeps it.
    await expect(page).toHaveURL(LIST);
    const queued = page.locator("[data-queued] li");
    await expect(queued).toContainText("Motion design");
    await expect(queued).toContainText(ADDED);
    await expect(queued.getByRole("button")).toHaveCount(0);
    expect(sent).toHaveLength(1);
    expect(ops(sent)).toEqual([
      {
        op: "topic.upsert",
        topic: {
          id: "motion-design",
          name: "Motion design",
          description: "Animation and motion in interfaces.",
          weight: 0.5,
          enabled: true,
          keywords: [],
          section_id: "motion-design",
        },
      },
    ]);
  });

  test("a refused detail keeps what was typed and sends nothing", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a topic" });
    const form = sheet.getByRole("form", { name: "Add a topic" });
    await form.getByLabel("Name").fill("Motion design");
    await sheet.getByRole("button", { name: "Add topic", exact: true }).click();
    await expect(form.getByText("Say what should count as this topic.")).toBeVisible();
    await expect(form.getByLabel("What should count as this topic")).toBeFocused();
    await expect(form.getByLabel("Name")).toHaveValue("Motion design");
    // Typing clears the note.
    await form.getByLabel("What should count as this topic").fill("Animation.");
    await expect(form.getByText("Say what should count as this topic.")).toBeHidden();
    await expect(sheet).toBeVisible();
    expect(sent).toHaveLength(0);
  });

  test("a topic cannot take the address of the Other page", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a topic" });
    const form = sheet.getByRole("form", { name: "Add a topic" });
    await form.getByLabel("Name").fill("Other");
    await form.getByLabel("What should count as this topic").fill("Anything else.");
    await sheet.getByRole("button", { name: "Add topic", exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(ops(sent)).toMatchObject([{ op: "topic.upsert", topic: { id: "other-2" } }]);
  });
});

test.describe("a topic's page", () => {
  // Design gathers the fixture's Design engineering craft and Product design (D69).
  const CRAFT = "/settings/topics/design";

  test("a weight change saves itself as one weights.set, shown as a percentage", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/audio_interfaces");
    const slider = page.locator("[data-weight]");
    await slider.fill("0.6");
    await expect(page.locator("[data-word]")).toHaveText("60%");
    await expect(toastText(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([{ op: "weights.set", weights: { audio_interfaces: 0.6 } }]);
  });

  test("Design weighs each topic it gathers by name; a group of one has a plain Weight row", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const weights = page.getByRole("region", { name: "Weights" });
    await expect(weights.getByRole("slider")).toHaveCount(2);
    await expect(weights.getByRole("slider").first()).toHaveAccessibleName(
      "Design engineering craft",
    );
    await weights.getByRole("slider", { name: "Product design" }).fill("0.5");
    await expect(toastText(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([{ op: "weights.set", weights: { product_design: 0.5 } }]);
    await open(page, "/settings/topics/ai");
    await expect(page.getByRole("region", { name: "Weights" })).toHaveCount(0);
    await expect(page.getByRole("slider", { name: "Weight", exact: true })).toHaveCount(1);
  });

  test("Scope is a list to tick: unticking Daily leaves every topic Design gathers out of it", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const field = page.getByRole("button", { name: /^Scope/ });
    await expect(field).toHaveText("Daily, Weekly and Custom");
    await field.click();
    const list = page.getByRole("listbox", { name: "Scope" });
    await expect(list).toBeVisible();
    await list.getByRole("option", { name: "Daily" }).click();
    await expect(field).toHaveText("Weekly and Custom");
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(field).toBeFocused();
    await expect(toastText(page)).toHaveText(SAVED);
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
    await expect(sheet.getByRole("radiogroup", { name: "What to add" })).toBeHidden();
    const name = sheet.getByRole("textbox", { name: "Name" });
    await expect(name).toHaveValue("Studio Notes");
    // Editing starts with reading: focus stays in the panel, off the field, so no keyboard comes up.
    await expect(name).not.toBeFocused();
    expect(await sheet.evaluate((panel) => panel.contains(document.activeElement))).toBe(true);
    await expect(sheet.getByRole("combobox", { name: "Topic" })).toHaveValue(
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

  test("moving a source to another topic says where it goes after the build", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    await source(page, "Studio Notes").getByRole("button", { name: "Edit Studio Notes" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit source" });
    await sheet.getByRole("combobox", { name: "Topic" }).selectOption("");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(source(page, "Studio Notes")).toContainText(
      "Moves to Other after the next build.",
    );
    await expect
      .poll(() => ops(sent))
      .toEqual([{ op: "source.update", id: "studio-notes", topic_ids: [] }]);
  });

  test("a source's name is a link to its site in a new tab; the rest of its row edits it", async ({
    page,
  }) => {
    await setup(page);
    await open(page, CRAFT);
    const link = source(page, "Studio Notes").getByRole("link", { name: "Studio Notes" });
    await expect(link).toHaveAttribute("href", "https://www.studio-notes.example/");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(source(page, "Studio Notes").getByRole("link")).toHaveCount(1);
    // The score lets a press through to the edit button behind the row.
    await source(page, "Studio Notes").locator(".score").click({ force: true });
    await expect(page.getByRole("dialog", { name: "Edit source" })).toBeVisible();
  });

  test("a source's score is out of 3, drawn as three pips beside the number", async ({ page }) => {
    await setup(page);
    await open(page, CRAFT);
    const score = source(page, "Studio Notes").locator(".score");
    const num = score.locator(".score-num");
    if ((await num.count()) > 0) {
      const value = Number(await num.textContent());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(3);
      await expect(score.locator(".pips")).toBeVisible();
    } else await expect(score.locator(".score-label")).toHaveText("New");
  });

  test("every source has a checkbox: unticking turns it off and ticking turns it back on", async ({
    page,
  }) => {
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
    // Off is quieter, never faded: the name keeps full opacity in the regular weight.
    await expect(row.locator(".source-name")).toHaveCSS("font-weight", "400");
    await expect(row.locator(".source-name")).toHaveCSS("opacity", "1");
    await box.check();
    await expect.poll(() => ops(sent).length).toBe(2);
    await expect(row.locator(".source-name")).toHaveCSS("font-weight", "500");
    expect(ops(sent)).toEqual([
      { op: "source.set", id: "studio-notes", enabled: false },
      { op: "source.set", id: "studio-notes", enabled: true },
    ]);
  });

  test("a change put back before it is sent sends nothing", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const box = source(page, "Studio Notes").getByRole("checkbox", { name: "Read Studio Notes" });
    await box.uncheck();
    await box.check();
    await page.waitForTimeout(1800);
    expect(sent).toHaveLength(0);
  });

  test("its Add source button opens the panel with the topic chosen", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/audio_interfaces");
    await page.getByRole("button", { name: "Add source to Audio interfaces" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a source" });
    await expect(sheet.getByRole("combobox", { name: "Topic" })).toHaveValue("audio_interfaces");
    await sheet.getByLabel("Site or feed address").fill("newsroom.example");
    await sheet.getByRole("button", { name: "Add source", exact: true }).click();
    const row = page.locator("[data-sources] li.source-row.is-new");
    await expect(row).toContainText("Newsroom Example");
    await expect(row).toContainText(ADDED);
    expect(ops(sent)).toEqual([
      { op: "source.add", url: "https://newsroom.example/", topic_ids: ["audio_interfaces"] },
    ]);
  });

  test("removing a custom topic waits with Undo, then says the page goes", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/audio_interfaces");
    await page.getByRole("button", { name: "Remove topic Audio interfaces" }).click();
    await expect(toastText(page)).toHaveText("Removing Audio interfaces");
    await expect(page.getByRole("button", { name: "Keep topic Audio interfaces" })).toBeVisible();
    await expect(page.getByText("Removed. The page goes after the next build.")).toBeVisible(
      AFTER_UNDO,
    );
    await expect(page.getByRole("button", { name: /^Scope/ })).toBeHidden();
    expect(ops(sent)).toEqual([{ op: "topic.remove", id: "audio_interfaces" }]);
  });

  test("a built-in topic cannot be removed", async ({ page }) => {
    await setup(page);
    await open(page, CRAFT);
    await expect(page.getByRole("button", { name: /^Remove topic/ })).toHaveCount(0);
  });

  test("a topic that never publishes and one the app no longer lists have no page; their sources are on Other", async ({
    page,
  }) => {
    await setup(page);
    await open(page);
    await expect(page.getByRole("link", { name: /^Venture capital and gossip/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Trending/ })).toHaveCount(0);
    await open(page, "/settings/topics/other");
    await expect(page.locator("li.source-row")).toHaveCount(2);
  });

  test("a general topic: Custom is its on switch, edit, sources with scores, no weight and no remove", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/world");
    await expect(page.getByRole("heading", { level: 1, name: "World" })).toBeVisible();
    await expect(page.getByText("General news is in custom episodes only")).toBeVisible();
    await expect(page.locator("[data-weight]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove topic/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add source to World" })).toBeVisible();
    await expect(source(page, "Meridian Wire").locator(".score-num")).toBeVisible();
    await expect(source(page, "Quiet Gazette").locator(".score")).toBeVisible();
    await expect(
      source(page, "Quiet Gazette").getByRole("checkbox", { name: "Read Quiet Gazette" }),
    ).not.toBeChecked();
    // What counts is editable, as for Design and Trending.
    await page.getByRole("button", { name: "Edit topic World" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit topic" });
    await expect(sheet.getByLabel("What should count as this topic")).toBeEditable();
    await sheet.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: /^Scope/ }).click();
    const list = page.getByRole("listbox", { name: "Scope" });
    await expect(list.getByRole("option", { name: /^Daily/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await list.getByRole("option", { name: /^Daily/ }).click({ force: true });
    await expect(list.getByRole("option", { name: /^Daily/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await list.getByRole("option", { name: "Custom" }).click();
    await expect(page.getByRole("button", { name: /^Scope/ })).toHaveText("In no podcast");
    await expect(toastText(page)).toHaveText(SAVED);
    expect(ops(sent)).toMatchObject([
      { op: "topic.upsert", topic: { id: "world", enabled: false, section_id: "general" } },
    ]);
  });

  test("an off source stays readable, and every name is a 44px target", async ({ page }) => {
    await setup(page);
    for (const path of ["/settings/topics/world", "/settings/topics/other"]) {
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
        .locator("a.source-name")
        .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height));
      expect(heights.length, path).toBeGreaterThan(0);
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    }
  });

  test("Other lists the sources with no topic, and can turn one back on", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/other");
    await expect(page.getByRole("heading", { level: 1, name: "Other" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Read Quiet Motion" }).check();
    await expect(toastText(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([{ op: "source.set", id: "quiet-motion", enabled: true }]);
  });

  test("no row is a dead zone: sources, and the suggestions under them, are 44px tall and touch", async ({
    page,
  }) => {
    await setup(page);
    await open(page, CRAFT);
    for (const list of ["[data-sources]", "[data-suggested-sources]"]) {
      const boxes = await page.locator(`${list} li.source-row`).evaluateAll((rows) =>
        rows.map((row) => {
          const rect = row.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }),
      );
      expect(boxes.length, list).toBeGreaterThan(1);
      for (const [index, box] of boxes.entries()) {
        expect(box.bottom - box.top).toBeGreaterThanOrEqual(44);
        const next = boxes[index + 1];
        if (next) expect(Math.abs(next.top - box.bottom)).toBeLessThanOrEqual(1);
      }
    }
  });
});

// The catalogue's feeds that fit a topic are in the page when it is built: no request, no waiting.
test.describe("a topic's suggested sources", () => {
  const DESIGN = "/settings/topics/design";
  const region = (page: Page) => page.getByRole("region", { name: "Suggested sources" });
  const names = (page: Page) => region(page).locator(".source-name");
  const suggestion = (page: Page, name: string) =>
    page.locator("[data-suggested-sources] li.source-row", { hasText: name });
  /** Where every row of both lists is on the page, to see that nothing moves. */
  const places = (page: Page) =>
    page
      .locator("[data-sources] li.source-row, [data-suggested-sources] li.source-row")
      .evaluateAll((rows) =>
        rows.map((row) => Math.round(row.getBoundingClientRect().top + scrollY)),
      );

  test("are the catalogue's feeds that fit the topic, with no score, no pill and nothing waiting", async ({
    page,
  }) => {
    await setup(page);
    await open(page, DESIGN);
    await expect(
      region(page).getByRole("heading", { level: 2, name: "Suggested sources" }),
    ).toBeVisible();
    await expect(
      region(page).getByText("Feeds that fit this topic. Add one to start reading it."),
    ).toBeVisible();
    // The five that fit Design and the topics it gathers best, best first. Type and Grid is a sixth,
    // and Model Ledger, which the owner reads already, is not offered.
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

  test("a row has the site's tile, its name as a link, the site, what it covers and how often it posts", async ({
    page,
  }) => {
    await setup(page);
    await open(page, DESIGN);
    const row = suggestion(page, "Pixel Ledger");
    await expect(row.locator(".source-initial")).toHaveText("P");
    const link = row.getByRole("link", { name: "Pixel Ledger" });
    await expect(link).toHaveAttribute("href", "https://pixel-ledger.example/");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(row.locator(".source-host")).toHaveText("pixel-ledger.example");
    await expect(row.locator(".source-line")).toHaveText(
      "Visual design critique and case studies \u00b7 Posts daily",
    );
    // The button is a 44px target.
    const add = row.getByRole("button", { name: "Add Pixel Ledger" });
    const box = await add.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test("+ adds the feed under the topic in one request, and the row says so without anything moving", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, DESIGN);
    const before = await places(page);
    const row = suggestion(page, "Motion Weekly");
    await row.getByRole("button", { name: "Add Motion Weekly" }).click();
    // The same button, done: a check, no longer pressable, named for what it did.
    const done = row.getByRole("button", { name: "Added Motion Weekly" });
    await expect(done).toBeDisabled();
    await expect(done).toHaveClass(/is-added/);
    await expect(toastText(page)).toHaveText(SAVED);
    await expect(row).toContainText(ADDED);
    expect(ops(sent)).toEqual([
      {
        op: "source.add",
        url: "https://motion-weekly.example/rss.xml",
        topic_ids: ["design_engineering_craft"],
      },
    ]);
    // Every row is where it was: nothing was put above the suggestions, and the page went nowhere.
    expect(await places(page)).toEqual(before);
    await expect(page.locator("[data-sources] li.source-row")).toHaveCount(2);
  });

  test("a general topic is offered feeds by its name, and + files the feed under it", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/world");
    await expect(names(page)).toHaveText(["Headline Desk"]);
    await suggestion(page, "Headline Desk")
      .getByRole("button", { name: "Add Headline Desk" })
      .click();
    await expect
      .poll(() => ops(sent))
      .toEqual([
        { op: "source.add", url: "https://headline-desk.example/rss", topic_ids: ["world"] },
      ]);
  });

  test("the owner's own topic is offered feeds by its name, what counts and its keywords", async ({
    page,
  }) => {
    await setup(page);
    await open(page, "/settings/topics/audio_interfaces");
    // What counts says "interface", which four feeds are tagged with; none is tagged audio or voice.
    await expect(names(page)).toHaveText([
      "Interface Notes",
      "Motion Weekly",
      "Craft Bench",
      "Agent Patterns",
    ]);
  });

  test("a feed that is among the sources already is not offered", async ({ page }) => {
    await setup(page);
    await open(page, "/settings/topics/ai");
    // Model Ledger fits AI best, and is one of its sources.
    await expect(names(page)).toHaveText(["Agent Patterns"]);
    await expect(source(page, "Model Ledger")).toHaveCount(1);
  });

  test("a page has no such section when nothing fits: Other, Sports and Culture", async ({
    page,
  }) => {
    await setup(page);
    for (const path of [
      "/settings/topics/other",
      "/settings/topics/sports",
      "/settings/topics/culture",
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
    await open(page, "/settings/topics/audio_interfaces");
    await page.getByRole("button", { name: "Edit topic Audio interfaces" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit topic" });
    const form = sheet.getByRole("form", { name: "Edit topic" });
    await expect(sheet.getByRole("radiogroup", { name: "What to add" })).toBeHidden();
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
            weight: 0.75,
          },
        },
      ]);
    expect(ops(sent)).toHaveLength(1);
  });

  test("a new topic sets its scope as it is added, in the same request", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a topic" });
    await sheet.getByRole("form", { name: "Add a topic" }).getByLabel("Name").fill("Spatial audio");
    await sheet.getByLabel("What should count as this topic").fill("Spatial audio in apps.");
    await sheet.getByRole("button", { name: /^Scope/ }).click();
    await sheet.getByRole("option", { name: "Weekly" }).click();
    await expect(sheet.getByRole("button", { name: /^Scope/ })).toHaveText("Daily and Custom");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Add topic", exact: true }).click();
    await expect
      .poll(() => ops(sent))
      .toMatchObject([
        { op: "topic.upsert", topic: { id: "spatial-audio", name: "Spatial audio" } },
        { op: "topic.scope", ids: ["spatial-audio"], weekly: false },
      ]);
  });

  test("Save waits until a detail changed, and putting it back waits again", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/audio_interfaces");
    await page.getByRole("button", { name: "Edit topic Audio interfaces" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit topic" });
    const name = sheet.getByRole("form", { name: "Edit topic" }).getByLabel("Name");
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

test.describe("a refused lookup", () => {
  test.use({ allowNetworkErrors: true });
  test("a source whose site has no icon shows its first letter instead", async ({ page }) => {
    await setup(page);
    await page.route("**/api/site-icon**", (route) => route.fulfill({ status: 404, body: "" }));
    await open(page, "/settings/topics/design_engineering_craft");
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
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    await page.getByRole("radio", { name: "Source" }).check();
    const sheet = page.getByRole("dialog", { name: "Add a source" });
    await sheet.getByLabel("Site or feed address").fill("nothing.example");
    await expect(sheet.getByRole("alert")).toContainText("could not be read");
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
  await open(page, "/settings/topics/design");
  expect(await scan()).toEqual([]);
  await page.getByRole("button", { name: /^Scope/ }).click();
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
  await open(page, "/settings/topics/audio_interfaces");
  await page.getByRole("button", { name: "Edit topic Audio interfaces" }).click();
  const editTopic = page.getByRole("dialog", { name: "Edit topic" });
  await expect(editTopic).toBeVisible();
  await settled(editTopic);
  expect(await scan()).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(editTopic).toBeHidden();
  await open(page);
  await page.getByRole("button", { name: "Add a topic or a source" }).click();
  const topic = page.getByRole("dialog", { name: "Add a topic" });
  await topic.getByRole("form", { name: "Add a topic" }).getByLabel("Name").fill("Motion design");
  // The panel as a refused detail leaves it: the note beside the field, with its alert glyph.
  await topic.getByRole("button", { name: "Add topic", exact: true }).click();
  await expect(topic.getByText("Say what should count as this topic.")).toBeVisible();
  await settled(topic);
  expect(await scan()).toEqual([]);
});

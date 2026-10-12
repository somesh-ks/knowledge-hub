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
const ADDED = "Added. It shows here in about a minute.";

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
    await expect(page.getByRole("heading", { level: 1, name: "Topics and sources" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a topic or a source" })).toBeVisible();
    const rows = [
      ["Design", "2 sources"],
      ["AI", "1 source"],
      ["Technology", "No sources yet"],
      ["Audio interfaces", "1 source"],
      ["Other", "2 sources"],
      ["World", "2 of 3 sources on"],
      ["Science", "1 source"],
      ["Sports", "No sources yet"],
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
    const crumb = page.locator(".settings-up");
    await expect(crumb).toHaveText("Topics and sources");
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
    // A name a topic already has is refused, whatever its case.
    await form.getByLabel("Name").fill("design");
    await add.click();
    await expect(form.getByText("You already have a topic called Design.")).toBeVisible();
    await form.getByLabel("Name").fill("Motion design");
    await form
      .getByLabel("What should count as this topic")
      .fill("Animation and motion in interfaces.");
    await add.click();
    await expect(sheet).toBeHidden();
    // The site is static: the topic's page exists after the next build, so the list keeps it.
    await expect(page).toHaveURL(LIST);
    const queued = page.locator("[data-queued] > li");
    await expect(queued).toContainText("Motion design");
    // It is sent at once, so there is no Cancel that would only pretend to drop it.
    await expect(queued.locator("[data-act=cancel]")).toHaveCount(0);
    await expect(queued).toContainText(ADDED);
    await expect(queued.locator("[data-act=cancel]")).toHaveCount(0);
    // Its suggested sources show at once, ranked in the browser as its page will rank them.
    const suggested = queued.getByRole("list", { name: "Suggested sources for Motion design" });
    await expect(suggested.getByRole("button", { name: "Add Motion Weekly" })).toBeVisible();
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

  test("a new topic's suggested source adds under it, and both stay listed on a reload before the build", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const form = page
      .getByRole("dialog", { name: "Add a topic" })
      .getByRole("form", { name: "Add a topic" });
    const sheet = page.getByRole("dialog", { name: "Add a topic" });
    await form.getByLabel("Name").fill("Motion design");
    await form
      .getByLabel("What should count as this topic")
      .fill("Animation and motion in interfaces.");
    await sheet.getByRole("button", { name: "Add topic", exact: true }).click();
    const queued = page.locator("[data-queued] > li");
    await expect(queued).toContainText(ADDED);
    await queued.getByRole("button", { name: "Add Motion Weekly" }).click();
    await expect(queued.getByRole("button", { name: "Added Motion Weekly" })).toBeDisabled();
    await expect
      .poll(() => ops(sent), { timeout: 15_000 })
      .toContainEqual({
        op: "source.add",
        url: "https://motion-weekly.example/rss.xml",
        topic_ids: ["motion-design"],
      });
    await expect(toastText(page)).toHaveText(SAVED);
    const before = sent.length;

    await page.reload();
    await open(page);
    await expect(page.locator("[data-saved-note]")).toHaveText(
      "Saved. It takes effect after the next update, about a minute.",
    );
    await expect(queued).toContainText("Motion design");
    await expect(queued).toContainText(ADDED);
    await expect(queued.getByRole("button", { name: "Added Motion Weekly" })).toBeDisabled();
    await page.waitForTimeout(1500);
    expect(sent.length).toBe(before);
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

  test("Podcasts is a list to tick: unticking Daily leaves every topic Design gathers out of it", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const field = page.getByRole("button", { name: /^Podcasts/ });
    await expect(field).toHaveText("All podcasts");
    await field.click();
    const list = page.getByRole("listbox", { name: "Podcasts" });
    await expect(list).toBeVisible();
    await list.getByRole("option", { name: "Daily" }).click();
    await expect(field).toHaveText("Weekly and Episodes");
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
    await expect(source(page, "Studio Notes")).toContainText("Moves to Other in about a minute.");
    await expect
      .poll(() => ops(sent))
      .toEqual([{ op: "source.update", id: "studio-notes", topic_ids: [] }]);
  });

  test("a source's name is plain words; its row edits it, and the panel links to the site", async ({
    page,
  }) => {
    await setup(page);
    await open(page, CRAFT);
    await expect(source(page, "Studio Notes").getByRole("link")).toHaveCount(0);
    // A press on the name or the score goes through to the edit button behind the row.
    await source(page, "Studio Notes").locator(".source-name").click({ force: true });
    const panel = page.getByRole("dialog", { name: "Edit source" });
    await expect(panel).toBeVisible();
    const link = panel.getByRole("link", { name: "Open Studio Notes in a new tab" });
    await expect(link).toHaveAttribute("href", "https://www.studio-notes.example/");
    await expect(link).toHaveAttribute("target", "_blank");
    // Close comes first in the header, as in the Create sheet.
    const close = await panel.getByRole("button", { name: "Close" }).boundingBox();
    const title = await panel.getByRole("heading", { level: 2 }).boundingBox();
    expect(close && title && close.x < title.x).toBe(true);
  });

  test("a source's score is one word on the line under its name, after the site", async ({
    page,
  }) => {
    await setup(page);
    await open(page, CRAFT);
    const row = source(page, "Studio Notes");
    await expect(row.locator(".source-meta")).toHaveText(/studio-notes\.example\s*Excellent/);
    await expect(row.locator(".pips, .score-num")).toHaveCount(0);
    await expect(source(page, "Type and Grid").locator(".score")).toHaveText("Not scored yet");
    const name = await row.locator(".source-name").boundingBox();
    const score = await row.locator(".score").boundingBox();
    expect(name && score && score.y >= name.y + name.height - 1).toBe(true);
    // The site tile keeps its 24px however long the name beside it is.
    await row.locator(".source-name").evaluate((node) => {
      node.textContent = "A very long source name that would squeeze anything beside it".repeat(3);
    });
    const tile = page.locator('li.source-row[data-id="studio-notes"] .source-icon');
    expect((await tile.boundingBox())?.width).toBeCloseTo(24, 0);
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
    // The second edit waits out the server's ten seconds between edits before it is sent.
    await expect.poll(() => ops(sent).length, { timeout: 15_000 }).toBe(2);
    await expect(row.locator(".source-name")).toHaveCSS("font-weight", "400");
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

  test("removing a custom topic waits with Undo, then goes back to the list without it", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/audio_interfaces");
    await page.getByRole("button", { name: "Remove topic Audio interfaces" }).click();
    await expect(toastText(page)).toHaveText("Removing Audio interfaces");
    await expect(page.getByRole("button", { name: "Keep topic Audio interfaces" })).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/topics$/, AFTER_UNDO);
    await expect(page.locator('a[href="/settings/topics/audio_interfaces"]')).toBeHidden();
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

  test("a general topic: a switch that says it stops reading its sources, edit, scores, no weight and no remove", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/world");
    await expect(page.getByRole("heading", { level: 1, name: "World" })).toBeVisible();
    await expect(page.locator("[data-weight]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove topic/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add source to World" })).toBeVisible();
    await expect(source(page, "Meridian Wire").locator(".score")).toBeVisible();
    await expect(source(page, "Quiet Gazette").locator(".score")).toBeVisible();
    await expect(
      source(page, "Quiet Gazette").getByRole("checkbox", { name: "Read Quiet Gazette" }),
    ).not.toBeChecked();
    // What counts is editable, as for Design and Trending.
    await page.getByRole("button", { name: "Edit topic World" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit topic" });
    await expect(sheet.getByLabel("What should count as this topic")).toBeEditable();
    await sheet.getByRole("button", { name: "Close" }).click();
    // No list of podcasts it can never join: one switch, named for what it does.
    await expect(page.getByRole("button", { name: /^Podcasts/ })).toHaveCount(0);
    const on = page.getByRole("switch", { name: "Read World's sources" });
    await expect(on).toBeChecked();
    await expect(on).toHaveAccessibleDescription("Used in episodes");
    await expect(page.getByText("Not read while World is off.")).toBeHidden();
    await on.uncheck();
    await expect(on).toHaveAccessibleDescription("Off. Its sources are not read");
    await expect(page.getByText("Not read while World is off.")).toBeVisible();
    await expect(toastText(page)).toHaveText(SAVED);
    expect(ops(sent)).toMatchObject([
      { op: "topic.upsert", topic: { id: "world", enabled: false, section_id: "general" } },
    ]);
  });

  test("the open Podcasts list is as wide as its options, and its value never widens the page", async ({
    page,
  }) => {
    await setup(page);
    await open(page, "/settings/topics/design");
    await page.getByRole("button", { name: /^Podcasts/ }).click();
    const list = page.getByRole("listbox");
    await list.evaluate((node) =>
      Promise.all(node.getAnimations().map((animation) => animation.finished)),
    );
    const box = await list.boundingBox();
    // Never narrower than 14rem, so the options never wrap word by word.
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(223.5);
    // Every option, hint included, fits inside the list without breaking word by word.
    for (const label of await list.locator(".multiselect-text").all()) {
      const inner = await label.boundingBox();
      expect(inner && box && inner.x + inner.width <= box.x + box.width).toBe(true);
    }
    for (const hint of await list.locator(".multiselect-hint").all()) {
      expect((await hint.boundingBox())?.height ?? 0).toBeLessThan(40);
    }
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, "/settings/topics/design");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    // The value is read whole at 360: none of it is cut off.
    const value = page.locator("[data-multiselect-value]");
    await expect(value).toHaveText("All podcasts");
    expect(await value.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });

  test("Suggested + discs end where the checkboxes above them end", async ({ page }) => {
    await setup(page);
    await open(page, CRAFT);
    const box = await source(page, "Studio Notes").locator(".suggest-box").boundingBox();
    const disc = await page
      .locator(".source-plus-btn")
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const inset = Number.parseFloat(getComputedStyle(node, "::before").insetInlineEnd);
        return rect.right - inset;
      });
    expect(box && Math.abs(box.x + box.width - disc)).toBeLessThanOrEqual(3);
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
        .locator("li.source-row .source-edit")
        .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
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
    // No line explains the list: the heading says it.
    await expect(region(page).locator(".manage-quiet")).toHaveCount(0);
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

  test("a row has the site's tile, its name in plain words, the site, what it covers and how often it posts", async ({
    page,
  }) => {
    await setup(page);
    await open(page, DESIGN);
    const row = suggestion(page, "Pixel Ledger");
    await expect(row.locator(".source-initial")).toHaveText("P");
    await expect(row.locator(".source-name")).toHaveText("Pixel Ledger");
    await expect(row.getByRole("link")).toHaveCount(0);
    await expect(row.locator(".source-host")).toHaveText("pixel-ledger.example");
    // Drawn as a source is: the site and how often it posts on line 2, what it covers on line 3.
    await expect(row.locator(".source-meta .source-host")).toHaveText("pixel-ledger.example");
    await expect(row.locator(".source-meta .source-cadence")).toHaveText("Posts daily");
    await expect(row.locator(".source-about")).toHaveText(
      "Visual design critique and case studies",
    );
    await expect(row.locator(".source-name")).toHaveCSS("font-weight", "400");
    const height = (await row.boundingBox())?.height ?? 0;
    expect(height).toBeGreaterThanOrEqual(71.5);
    const own = (await source(page, "Studio Notes").boundingBox())?.height ?? 0;
    expect(own).toBeGreaterThanOrEqual(71.5);
    // The plus is a plain icon button: no disc behind it.
    const disc = await row
      .getByRole("button", { name: "Add Pixel Ledger" })
      .evaluate((node) => getComputedStyle(node, "::before").backgroundColor);
    expect(disc).toBe("rgba(0, 0, 0, 0)");
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
    await sheet.getByRole("button", { name: /^Podcasts/ }).click();
    await sheet.getByRole("option", { name: "Weekly" }).click();
    await expect(sheet.getByRole("button", { name: /^Podcasts/ })).toHaveText("Daily and Episodes");
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
    await expect(sheet.locator("#panel-source-url-error")).toContainText("could not be read");
    await expect(sheet.getByLabel("Site or feed address")).toHaveAttribute("aria-invalid", "");
    // No empty card stands in for the message.
    await expect(sheet.locator(".source-card")).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Add source", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});

test.describe("the Add panel on a 390px phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, allowNetworkErrors: true });

  const kindHeight = (page: Page) =>
    page.locator(".topics-panel-kind").evaluate((node) => {
      const probe = document.createElement("div");
      probe.style.blockSize = "var(--segmented-height)";
      document.body.append(probe);
      const want = probe.getBoundingClientRect().height;
      probe.remove();
      return { got: node.getBoundingClientRect().height, want };
    });
  const fieldTop = (page: Page) =>
    page
      .getByLabel("Site or feed address")
      .evaluate((node) => Math.round(node.getBoundingClientRect().top));

  test("the Topic | Source switch is one segmented height, and the address never moves", async ({
    page,
  }) => {
    await setup(page);
    let fail = false;
    await page.route("**/api/source-preview**", (route) =>
      fail
        ? route.fulfill({
            status: 422,
            contentType: "application/json",
            body: JSON.stringify({ error: "unreachable", message: "x" }),
          })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(PREVIEW),
          }),
    );
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const topic = await kindHeight(page);
    expect(topic.got).toBeCloseTo(topic.want, 0);
    await page.getByRole("radio", { name: "Source" }).check();
    const sheet = page.getByRole("dialog", { name: "Add a source" });
    await expect(sheet).toBeVisible();
    const source = await kindHeight(page);
    expect(source.got).toBeCloseTo(source.want, 0);
    const before = await fieldTop(page);
    await sheet.getByLabel("Site or feed address").fill("newsroom.example");
    await expect(sheet.getByText("Newsroom Example")).toBeVisible();
    expect(await fieldTop(page)).toBe(before);
    fail = true;
    await sheet.getByLabel("Site or feed address").fill("nothing.example");
    await expect(sheet.locator("#panel-source-url-error")).toContainText("could not be read");
    expect(await fieldTop(page)).toBe(before);
    expect((await kindHeight(page)).got).toBeCloseTo(source.want, 0);
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
  await page.getByRole("button", { name: /^Podcasts/ }).click();
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

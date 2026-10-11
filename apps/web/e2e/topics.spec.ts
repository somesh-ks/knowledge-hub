import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
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

const source = (page: Page, name: string) => page.locator("li.source-row", { hasText: name });
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
      ["Design engineering craft", "Weight 95%, 1 source"],
      ["Consumer tech releases", "Off, 0 sources"],
      ["Venture capital and gossip", "Never in a briefing"],
      ["Other", "1 source with no topic yet"],
    ] as const;
    for (const [name, hint] of rows) {
      await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toContainText(hint);
    }
    await expect(page.locator("li.source-row")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Show sources with score" })).toHaveCount(0);
    await expect(page.getByText("Top picks")).toHaveCount(0);
  });

  test("a row leads to the topic's page, whose title leads back", async ({ page }) => {
    await setup(page);
    await open(page);
    await page.getByRole("link", { name: /^Design engineering craft/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Design engineering craft" }),
    ).toBeVisible();
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

  test("a new topic is offered the catalogue's sources that suit it, and the ticked ones go with it", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a topic" });
    const form = sheet.getByRole("form", { name: "Add a topic" });
    // Next refuses details that are missing, beside the field.
    await sheet.getByRole("button", { name: "Next" }).click();
    await expect(form.getByText("Enter a name.")).toBeVisible();
    await form.getByLabel("Name").fill("Motion design");
    await form
      .getByLabel("What should count as this topic")
      .fill("Animation and motion in interfaces.");
    await form.getByLabel(/Keywords/).fill("transitions");
    await sheet.getByRole("button", { name: "Next" }).click();
    const offers = sheet
      .getByRole("group", { name: "Sources to start with" })
      .getByRole("checkbox");
    await expect(offers).toHaveCount(6);
    await expect(sheet.locator(".suggest-row").first()).toContainText("Motion Weekly");
    await expect(sheet.getByRole("button", { name: "Add topic", exact: true })).toBeVisible();
    await sheet.getByRole("checkbox", { name: /Motion Weekly/ }).check();
    await sheet.getByRole("checkbox", { name: /Craft Bench/ }).check();
    await sheet.getByRole("button", { name: "Add topic and 2 sources" }).click();
    await expect(sheet).toBeHidden();
    const queued = page.locator("[data-queued] li");
    await expect(queued).toContainText("Motion design");
    await expect(queued).toContainText(ADDED);
    await expect(queued.getByRole("button")).toHaveCount(0);
    await expect(page.locator("[data-added] li.source-row")).toHaveCount(2);
    // The topic and its sources travel together, the topic first.
    expect(sent).toHaveLength(1);
    expect(ops(sent)).toMatchObject([
      { op: "topic.upsert", topic: { id: "motion-design", keywords: ["transitions"] } },
      {
        op: "source.add",
        url: "https://motion-weekly.example/rss.xml",
        topic_ids: ["motion-design"],
      },
      {
        op: "source.add",
        url: "https://craft-bench.example/feed.xml",
        topic_ids: ["motion-design"],
      },
    ]);
  });

  test("Back on the sources step returns to the topic's details as they were typed", async ({
    page,
  }) => {
    await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a topic" });
    const form = sheet.getByRole("form", { name: "Add a topic" });
    await form.getByLabel("Name").fill("Motion design");
    await form.getByLabel("What should count as this topic").fill("Animation in interfaces.");
    await sheet.getByRole("button", { name: "Next" }).click();
    await sheet.getByRole("button", { name: "Back" }).click();
    await expect(form.getByLabel("Name")).toHaveValue("Motion design");
    await expect(form.getByLabel("Name")).toBeFocused();
  });

  test("a topic cannot take the address of the Other page", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add a topic or a source" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a topic" });
    const form = sheet.getByRole("form", { name: "Add a topic" });
    await form.getByLabel("Name").fill("Other");
    await form.getByLabel("What should count as this topic").fill("Anything else.");
    await sheet.getByRole("button", { name: "Next" }).click();
    await sheet.getByRole("button", { name: "Add topic", exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(ops(sent)).toMatchObject([{ op: "topic.upsert", topic: { id: "other-2" } }]);
  });
});

test.describe("a topic's page", () => {
  const CRAFT = "/settings/topics/design_engineering_craft";

  test("a weight change saves itself as one weights.set, shown as a percentage", async ({
    page,
  }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const slider = page.locator("[data-weight]");
    await slider.fill("0.6");
    await expect(page.locator("[data-word]")).toHaveText("60%");
    await expect(toastText(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([{ op: "weights.set", weights: { design_engineering_craft: 0.6 } }]);
  });

  test("the switch sends the topic with its current weight", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/frontier_model_releases");
    await page.locator("[data-weight]").fill("0.3");
    await page.getByRole("switch", { name: "In briefings" }).click();
    await expect.poll(() => ops(sent).some((op) => op.op === "topic.upsert")).toBe(true);
    const upsert = ops(sent).find((op) => op.op === "topic.upsert") as {
      topic: { id: string; enabled: boolean; weight: number };
    };
    expect(upsert.topic).toMatchObject({ id: "frontier_model_releases", enabled: false });
    expect(upsert.topic.weight).toBeCloseTo(0.3);
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
    await expect(name).toBeFocused();
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

  test("a source's open button goes to its site in a new tab", async ({ page }) => {
    await setup(page);
    await open(page, CRAFT);
    const link = source(page, "Studio Notes").getByRole("link", {
      name: "Open Studio Notes in a new tab",
    });
    await expect(link).toHaveAttribute("href", "https://www.studio-notes.example/");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
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

  test("removing a source waits with Undo, and Undo takes it back", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, CRAFT);
    const row = source(page, "Studio Notes");
    await row.getByRole("button", { name: "Remove Studio Notes" }).click();
    await expect(toastText(page)).toHaveText("Removing Studio Notes");
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(toast(page)).toBeHidden();
    await expect(row.getByRole("button", { name: "Remove Studio Notes" })).toBeVisible();
    // The row's own button takes it back as well.
    await row.getByRole("button", { name: "Remove Studio Notes" }).click();
    await row.getByRole("button", { name: "Undo removing Studio Notes" }).click();
    await expect(toast(page)).toBeHidden();
    await page.waitForTimeout(1500);
    expect(sent).toHaveLength(0);
    await row.getByRole("button", { name: "Remove Studio Notes" }).click();
    await expect(row).toBeHidden(AFTER_UNDO);
    expect(ops(sent)).toEqual([{ op: "source.set", id: "studio-notes", enabled: false }]);
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
    await expect(page.getByRole("switch", { name: "In briefings" })).toBeHidden();
    expect(ops(sent)).toEqual([{ op: "topic.remove", id: "audio_interfaces" }]);
  });

  test("a built-in topic cannot be removed", async ({ page }) => {
    await setup(page);
    await open(page, CRAFT);
    await expect(page.getByRole("button", { name: /^Remove topic/ })).toHaveCount(0);
  });

  test("a topic that never publishes has only its sources", async ({ page }) => {
    await setup(page);
    await open(page, "/settings/topics/venture_capital_and_gossip");
    await expect(page.getByText("Never in a briefing.")).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Add source/ })).toHaveCount(0);
  });

  test("Other lists the sources with no topic, and can turn one back on", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page, "/settings/topics/other");
    await expect(page.getByRole("heading", { level: 1, name: "Other" })).toBeVisible();
    await page.getByRole("switch", { name: "Turn on Quiet Motion" }).click();
    await expect(toastText(page)).toHaveText(SAVED);
    expect(ops(sent)).toEqual([{ op: "source.set", id: "quiet-motion", enabled: true }]);
  });

  test("no row is a dead zone: sources are at least 44px tall and touch", async ({ page }) => {
    await setup(page);
    await open(page, CRAFT);
    const boxes = await page.locator("li.source-row").evaluateAll((rows) =>
      rows.map((row) => {
        const rect = row.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    );
    for (const [index, box] of boxes.entries()) {
      expect(box.bottom - box.top).toBeGreaterThanOrEqual(44);
      const next = boxes[index + 1];
      if (next) expect(Math.abs(next.top - box.bottom)).toBeLessThanOrEqual(1);
    }
  });
});

// The browser logs the refused lookup itself; the panel answers it in words.
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

test("has no accessibility violations: the list, a topic, and the panel open", async ({ page }) => {
  await setup(page);
  const scan = async () =>
    (await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
  await open(page);
  expect(await scan()).toEqual([]);
  await open(page, "/settings/topics/design_engineering_craft");
  expect(await scan()).toEqual([]);
  await page.getByRole("button", { name: "Add source to Design engineering craft" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a source" });
  await sheet.getByLabel("Site or feed address").fill("newsroom.example");
  await expect(sheet.getByText("Newsroom Example")).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await source(page, "Studio Notes").getByRole("button", { name: "Edit Studio Notes" }).click();
  await expect(page.getByRole("dialog", { name: "Edit source" })).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.keyboard.press("Escape");
  await open(page);
  await page.getByRole("button", { name: "Add a topic or a source" }).click();
  const topic = page.getByRole("dialog", { name: "Add a topic" });
  await topic.getByRole("form", { name: "Add a topic" }).getByLabel("Name").fill("Motion design");
  await topic.getByLabel("What should count as this topic").fill("Animation in interfaces.");
  await topic.getByRole("button", { name: "Next" }).click();
  await expect(topic.getByRole("checkbox").first()).toBeVisible();
  expect(await scan()).toEqual([]);
});

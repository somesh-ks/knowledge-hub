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
  score: 4.2,
  score_label: "Good",
  reason: "Posts often and most posts are on topic.",
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
    await expect(page.getByRole("heading", { level: 1, name: "Topics" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add source", exact: true })).toBeVisible();
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
    await expect(crumb).toHaveText("Topics");
    await expect(crumb).toHaveAttribute("href", LIST);
    await expect(source(page, "Studio Notes")).toBeVisible();
  });

  test("Add source files the source under the topic chosen in the panel", async ({ page }) => {
    const { sent, previews } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add source", exact: true }).click();
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
    await sheet.getByLabel("Topic").selectOption("audio_interfaces");
    await add.click();
    await expect(sheet).toBeHidden();
    const row = page.locator("[data-added] li.source-row.is-new");
    await expect(row).toContainText("Newsroom Example");
    await expect(row).toContainText(ADDED);
    expect(ops(sent)).toEqual([
      { op: "source.add", url: "https://newsroom.example/", topic_ids: ["audio_interfaces"] },
    ]);
  });

  test("Add topic saves itself and says it is added", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByText("Add topic", { exact: true }).first().click();
    const form = page.getByRole("form", { name: "Add a topic" });
    await form.getByLabel("Name").fill("Sound design");
    await form.getByLabel("What should count as this topic").fill("Sound in interfaces.");
    await form.getByLabel(/Keywords/).fill("audio, haptics");
    await form.getByRole("button", { name: "Add topic" }).click();
    const queued = page.locator("[data-queued] li");
    await expect(queued).toContainText("Sound design");
    await expect(queued).toContainText(ADDED);
    await expect(queued.getByRole("button")).toHaveCount(0);
    expect(ops(sent)).toMatchObject([
      { op: "topic.upsert", topic: { id: "sound-design", keywords: ["audio", "haptics"] } },
    ]);
  });

  test("a topic cannot take the address of the Other page", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByText("Add topic", { exact: true }).first().click();
    const form = page.getByRole("form", { name: "Add a topic" });
    await form.getByLabel("Name").fill("Other");
    await form.getByLabel("What should count as this topic").fill("Anything else.");
    await form.getByRole("button", { name: "Add topic" }).click();
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
    await expect(sheet.getByLabel("Topic")).toHaveValue("audio_interfaces");
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
    await page.getByRole("button", { name: "Add source", exact: true }).click();
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
});

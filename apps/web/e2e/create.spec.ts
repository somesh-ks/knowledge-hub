import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { PASSPHRASE_OFF, PASSPHRASE_ON, PASSPHRASE_REQUIRED } from "./passphrase";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PASSPHRASE = "correct horse battery staple";
/** What the page sends as the passphrase: what was typed, or the fixed value while none is asked. */
const SENT = PASSPHRASE_REQUIRED ? PASSPHRASE : "open";
const STORAGE_KEY = "dispatch:narrate-passphrase";
const EPISODE = "/e/ep-20261007-1930";
const EPISODE_ID = "ep-20261007-1930";

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
}

interface Mock {
  /** The JSON of every POST /api/podcast the page made. */
  bodies: Array<Record<string, unknown>>;
}

/** Answers POST /api/podcast with `status` and `body`, and records what was sent. */
async function mockPodcast(page: Page, status: number, body: unknown): Promise<Mock> {
  const mock: Mock = { bodies: [] };
  await page.route("**/api/podcast", async (route: Route) => {
    mock.bodies.push(route.request().postDataJSON());
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return mock;
}

const chip = (page: Page, name: string) => page.locator(".create-chip:visible", { hasText: name });
const segment = (page: Page, name: string) => page.locator(".settings-segment", { hasText: name });
const option = (page: Page, name: string) => page.locator(".create-option", { hasText: name });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Enter the passphrase" });
const estimate = (page: Page) => page.locator("[data-estimate]");

/** Opens the page and waits for its script, which is what makes the form do anything. */
async function openCreate(page: Page): Promise<void> {
  await page.goto("/create");
  await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
}

/**
 * Chooses two topics and presses Create. While a passphrase is asked for, that opens its dialog;
 * while it is not, the request is already on its way.
 */
async function openDialog(page: Page): Promise<void> {
  await chip(page, "Design Engineering").click();
  await chip(page, "Trending").click();
  await page.locator("[data-submit]").click();
  if (PASSPHRASE_REQUIRED) await expect(dialog(page)).toBeVisible();
}

/** Answers the passphrase dialog. With the step off there is none to answer. */
async function confirm(page: Page): Promise<void> {
  if (!PASSPHRASE_REQUIRED) return;
  await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
  await dialog(page).getByRole("button", { name: "Create episode" }).click();
}

test.describe("the Create page", () => {
  test("shows no error line, and no part of one, before anything has gone wrong", async ({
    page,
  }) => {
    await openCreate(page);
    // Hidden in the DOM is not enough: a display rule on the line once showed its icon anyway.
    for (const line of await page.locator("[data-error]").all()) await expect(line).toBeHidden();
    // Nothing is running, so the indicator has nothing to say.
    await expect(page.locator("[data-run-card]")).toBeHidden();
  });

  test("introduces itself in two lines and offers every choice", async ({ page }) => {
    await openCreate(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create a podcast");
    await expect(page.locator(".create-lede")).toHaveText(
      "Pick topics and a length. Singularity writes and reads an episode from the last few days of stories.",
    );
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Written for",
      "Topics",
      "Length",
      "Format",
      "Look back",
      "Tone",
      "Title",
    ]);
    // The five topics in the contract's order, then the owner's own in Customized mode.
    await expect(page.locator(".create-chip:visible")).toHaveText([
      "Design",
      "Design Engineering",
      "AI Products",
      "Tech Product Launches",
      "Trending",
      "Audio interfaces",
    ]);
    await expect(page.locator('input[name="length"]')).toHaveCount(4);
    await expect(page.locator('input[name="window"]')).toHaveCount(3);
    await expect(page.locator('input[name="tone"]')).toHaveCount(3);
    await expect(page.locator(".create-option")).toHaveText([
      /Readout\s*One host tells each story\./,
      /Discussion\s*Two hosts talk it through\./,
      /Headlines\s*Quick hits, a line or two each\./,
    ]);
    // Sensible defaults are already chosen, and no topic is.
    await expect(page.locator('input[name="length"]:checked')).toHaveValue("5");
    await expect(page.locator('input[name="format"]:checked')).toHaveValue("readout");
    await expect(page.locator('input[name="window"]:checked')).toHaveValue("7");
    await expect(page.locator('input[name="tone"]:checked')).toHaveValue("neutral");
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(0);
  });

  test("needs at least one topic before it asks for the passphrase", async ({ page }) => {
    await openCreate(page);
    const error = page.locator('[data-error="topics"]');
    await expect(error).toBeHidden();
    await page.locator("[data-submit]").click();
    await expect(error).toBeVisible();
    await expect(error).toHaveText("Pick at least one topic.");
    await expect(dialog(page)).toBeHidden();
    // Focus goes to the first topic, where the fix is.
    await expect(page.locator('input[name="topic"]').first()).toBeFocused();
    // Choosing one clears the message.
    await chip(page, "AI Products").click();
    await expect(error).toBeHidden();
  });

  test("counts the topics, and stops at six", async ({ page }) => {
    await openCreate(page);
    await expect(page.locator("#create-topics-hint")).toHaveText(
      "Choose up to 6. None chosen yet.",
    );
    await chip(page, "Design").first().click();
    await expect(page.locator("#create-topics-hint")).toHaveText("Choose up to 6. 1 chosen.");
    for (const name of [
      "Design Engineering",
      "AI Products",
      "Tech Product Launches",
      "Trending",
      "Audio interfaces",
    ]) {
      await chip(page, name).click();
    }
    await expect(page.locator("#create-topics-hint")).toHaveText("Choose up to 6. 6 chosen.");
    await chip(page, "Trending").click();
    await expect(page.locator("#create-topics-hint")).toHaveText("Choose up to 6. 5 chosen.");
  });

  test("Top picks is not a chip, and a line says every episode opens with it", async ({ page }) => {
    await openCreate(page);
    await expect(page.locator(".create-chip", { hasText: "Top picks" })).toHaveCount(0);
    await expect(page.locator('input[name="topic"][value="top"]')).toHaveCount(0);
    await expect(page.getByText("Every episode opens with the top picks.")).toBeVisible();
  });

  test("choosing a mode changes the line under it and the audience in the request", async ({
    page,
  }) => {
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 3, started_at: "x" });
    await openCreate(page);
    const hint = page.locator("[data-audience-hint]");
    await expect(page.locator('input[name="audience"]:checked')).toHaveValue("custom");
    await expect(hint).toHaveText("Written for you. Also draws on your own topics.");
    await chip(page, "Audio interfaces").click();
    await segment(page, "General").click();
    await expect(hint).toHaveText("Written for anyone. Explains terms as it goes.");
    // The owner's own topic leaves the list, and is unticked.
    await expect(page.locator(".create-chip", { hasText: "Audio interfaces" })).toBeHidden();
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(0);
    await chip(page, "Technology").click();
    await page.locator("[data-submit]").click();
    await confirm(page);
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toMatchObject({
      audience: "general",
      topic_ids: ["technology"],
    });
    expect(JSON.stringify(mock.bodies[0])).not.toContain('"top"');
  });

  test("General offers six general topics and hides the five; Customized brings them back", async ({
    page,
  }) => {
    await openCreate(page);
    const visible = page.locator(".create-chip:visible");
    const top = page.locator("[data-top-hint]");
    await expect(top).toHaveText("Every episode opens with the top picks.");
    await segment(page, "General").click();
    await expect(visible).toHaveText([
      "World",
      "Business",
      "Technology",
      "Science",
      "Culture",
      "Sports",
    ]);
    await expect(top).toHaveText("Every episode opens with the day's top stories.");
    await expect(page.locator(".create-chip", { hasText: "Design Engineering" })).toBeHidden();
    await segment(page, "Customized").click();
    await expect(visible).toHaveText([
      "Design",
      "Design Engineering",
      "AI Products",
      "Tech Product Launches",
      "Trending",
      "Audio interfaces",
    ]);
    await expect(top).toHaveText("Every episode opens with the top picks.");
  });

  test("a ticked Customized topic is unticked and not sent after switching to General", async ({
    page,
  }) => {
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 3, started_at: "x" });
    await openCreate(page);
    await chip(page, "Trending").click();
    await chip(page, "Design").first().click();
    await expect(page.locator("#create-topics-hint")).toHaveText("Choose up to 6. 2 chosen.");
    await segment(page, "General").click();
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(0);
    await expect(page.locator("#create-topics-hint")).toHaveText(
      "Choose up to 6. None chosen yet.",
    );
    await chip(page, "World").click();
    await chip(page, "Sports").click();
    await expect(page.locator("#create-topics-hint")).toHaveText("Choose up to 6. 2 chosen.");
    await page.locator("[data-submit]").click();
    await confirm(page);
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toMatchObject({
      audience: "general",
      topic_ids: ["world", "sports"],
    });
  });

  test("updates the estimate as the length changes", async ({ page }) => {
    await openCreate(page);
    await expect(estimate(page)).toHaveText(
      "About 5 minutes, roughly 4,800 characters of narration.",
    );
    await segment(page, "10 min").click();
    await expect(estimate(page)).toHaveText(
      "About 10 minutes, roughly 9,600 characters of narration.",
    );
    await segment(page, "15 min").click();
    await expect(estimate(page)).toHaveText(
      "About 15 minutes, roughly 14,400 characters of narration.",
    );
    await segment(page, "3 min").click();
    await expect(estimate(page)).toHaveText(
      "About 3 minutes, roughly 2,880 characters of narration.",
    );
    // The other choices do not change what is said about the length.
    await option(page, "Discussion").click();
    await expect(estimate(page)).toHaveText(
      "About 3 minutes, roughly 2,880 characters of narration.",
    );
  });

  test("with the passphrase step off, Create sends straight away and mentions none", async ({
    page,
  }) => {
    test.skip(PASSPHRASE_REQUIRED, PASSPHRASE_ON);
    // The clock is held, so the page never gets as far as asking after the run.
    await page.clock.install();
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 5, started_at: "x" });
    await openCreate(page);
    await expect(page.getByText(/passphrase/i)).toHaveCount(0);
    await chip(page, "Trending").click();
    await page.locator("[data-submit]").click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.passphrase).toBe("open");
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("asks for the passphrase in a dialog that can be cancelled", async ({ page }) => {
    test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);
    await openCreate(page);
    await openDialog(page);
    await expect(dialog(page).getByLabel("Passphrase")).toBeFocused();
    await expect(dialog(page).getByLabel("Remember on this device")).not.toBeChecked();
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    // Escape closes it too.
    await page.locator("[data-submit]").click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });

  test("will not send an empty passphrase", async ({ page }) => {
    test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 1, started_at: "x" });
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText("Enter the passphrase to continue.");
    expect(mock.bodies).toHaveLength(0);
  });

  test("sends the choices and the passphrase, then follows the run to the end", async ({
    page,
  }) => {
    await page.clock.install();
    const mock = await mockPodcast(page, 202, {
      status: 202,
      run_id: 4242,
      started_at: "2026-10-07T12:00:00.000Z",
    });
    const states = [
      { run_id: 4242, state: "queued", step: null },
      { run_id: 4242, state: "running", step: null },
      { run_id: 4242, state: "completed", step: null, outcome: "published" },
    ];
    const asked: string[] = [];
    await page.route("**/api/status?**", async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get("run") ?? "");
      const next = states[Math.min(asked.length - 1, states.length - 1)];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(next),
      });
    });
    await openCreate(page);

    await chip(page, "Design Engineering").click();
    await chip(page, "Trending").click();
    await segment(page, "10 min").click();
    await option(page, "Discussion").click();
    await segment(page, "A month").click();
    await segment(page, "Dry").click();
    await page.getByLabel("Title").fill("  My week in AI  ");
    await page.locator("[data-submit]").click();

    await confirm(page);

    // The request is exactly what was chosen, and the passphrase rides beside it.
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]).toEqual({
      passphrase: SENT,
      request: {
        audience: "custom",
        topic_ids: ["ui-craft", "trending"],
        length_minutes: 10,
        format: "discussion",
        window_days: 30,
        tone: "dry",
        title: "My week in AI",
      },
    });

    // The form stays; the progress is a line in the indicator, which says so in words.
    const card = page.locator("[data-run-card]");
    const text = page.locator("[data-run-text]");
    await expect(card).toBeVisible();
    await expect(page.locator("[data-create-form]")).toBeVisible();
    await expect(text).toHaveText("Waiting to start");

    await page.clock.runFor(4000);
    await expect(text).toHaveText("Waiting to start");
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Writing your episode");
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Episode ready");
    expect(asked).toEqual(["4242", "4242", "4242"]);
    await expect(page.getByRole("link", { name: "Open Library" })).toHaveAttribute(
      "href",
      "/library",
    );

    // Once finished it can be dismissed, and then it is gone.
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toBeHidden();
  });

  test("tells a failed run apart from a started one", async ({ page }) => {
    await page.clock.install();
    await mockPodcast(page, 202, { status: 202, run_id: 9, started_at: "2026-10-07T12:00:00Z" });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ run_id: 9, state: "completed", step: null, outcome: "failed" }),
      }),
    );
    await openCreate(page);
    await openDialog(page);
    await confirm(page);
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await page.clock.runFor(4000);
    await expect(page.locator("[data-run-text]")).toHaveText(
      "The episode could not be written. Try again later.",
    );
    await expect(page.getByRole("link", { name: "Open Library" })).toBeHidden();
  });
});

test.describe("the Create page when the server says no", () => {
  // A 4xx or a dropped request is logged by the browser as a failed load; here it is the point.
  test.use({ allowNetworkErrors: true });

  test("leaves the title out when it is empty, and sends no title key", async ({ page }) => {
    const mock = await mockPodcast(page, 400, { status: 400, error: "invalid_request" });
    await openCreate(page);
    await openDialog(page);
    await confirm(page);
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toEqual({
      audience: "custom",
      topic_ids: ["ui-craft", "trending"],
      length_minutes: 5,
      format: "readout",
      window_days: 7,
      tone: "neutral",
    });
  });

  test("says a wrong passphrase in words and keeps the dialog open", async ({ page }) => {
    test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);
    await mockPodcast(page, 401, { status: 401, error: "wrong_passphrase" });
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByLabel("Passphrase").fill("not it");
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "That passphrase does not match. Check it and try again.",
    );
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator("[data-run-card]")).toBeHidden();
    // The wrong one is not kept.
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  });

  test("names each refusal in words, on the page, and closes the dialog", async ({ page }) => {
    const cases: Array<[number, unknown, string]> = [
      [
        429,
        { status: 429, error: "cooldown", retry_after_s: 1500 },
        "Episodes need a short rest between them. Try again in 25 minutes.",
      ],
      [
        429,
        { status: 429, error: "daily_cap", retry_after_s: 3 * 3600 },
        "The limit for today is reached. Try again in 3 hours.",
      ],
      [
        503,
        { status: 503, error: "unavailable" },
        "Episodes are not available right now. Try again in a few minutes.",
      ],
      [
        400,
        { status: 400, error: "invalid_request" },
        "That request did not go through. Reload the page and try again.",
      ],
    ];
    await openCreate(page);
    await chip(page, "Trending").click();
    for (const [status, body, words] of cases) {
      await page.unroute("**/api/podcast");
      await mockPodcast(page, status, body);
      await page.locator("[data-submit]").click();
      await confirm(page);
      await expect(dialog(page)).toBeHidden();
      await expect(page.locator('[data-error="form"]')).toHaveText(words);
      await expect(page.locator("[data-create-form]")).toBeVisible();
      await expect(page.locator("[data-run-card]")).toBeHidden();
    }
  });

  test("says so when the request cannot be sent", async ({ page }) => {
    await page.route("**/api/podcast", (route) => route.abort("failed"));
    await openCreate(page);
    await openDialog(page);
    await confirm(page);
    await expect(page.locator('[data-error="form"]')).toHaveText(
      "The request did not go through. Check your connection, then try again.",
    );
  });

  test("keeps the passphrase on this device only when asked, and offers it next time", async ({
    page,
  }) => {
    test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);
    await mockPodcast(page, 202, { status: 202, run_id: 7, started_at: "2026-10-07T12:00:00Z" });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
    );
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
    await dialog(page).getByLabel("Remember on this device").check();
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(page.locator("[data-run-card]")).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(PASSPHRASE);

    // A page that cannot follow the run still says the episode was started.
    await expect(page.locator("[data-run-text]")).toHaveText("Episode started", {
      timeout: 15_000,
    });

    await page.reload();
    await openDialog(page);
    await expect(dialog(page).getByLabel("Passphrase")).toHaveValue(PASSPHRASE);
    await expect(dialog(page).getByLabel("Remember on this device")).toBeChecked();
  });
});

test.describe("navigation with three destinations and one action", () => {
  test("fits at 320px, every item a full target, and marks none as current on Create", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openCreate(page);
    const items = page.locator(".app-nav-item");
    await expect(items).toHaveText(["Today", "Library", "Settings"]);
    const boxes = await items.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const label = node.querySelector("span");
        const text = label?.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          width: box.width,
          height: box.height,
          textWidth: text?.width ?? 0,
          clipped: label ? label.scrollWidth > label.clientWidth : false,
        };
      }),
    );
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(320);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.textWidth).toBeLessThanOrEqual(box.width);
      expect(box.clipped).toBe(false);
    }
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index]?.left ?? 0).toBeGreaterThanOrEqual((boxes[index - 1]?.right ?? 0) - 0.5);
    }
    await expect(page.locator('.app-nav-item[aria-current="page"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });

  test("the deep link /create is the page, with the form in it and the Create button beside the list", async ({
    page,
  }) => {
    await openCreate(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create a podcast");
    // The page has the form itself, so it carries no sheet to clone.
    await expect(page.locator("#create-sheet-template")).toHaveCount(0);
    await chip(page, "Trending").click();
    await expect(page.locator("#create-topics-hint")).toHaveText("Choose up to 6. 1 chosen.");
  });
});

test.describe("episodes in the Library", () => {
  test("show beside the briefings, say their format and length, and have a filter", async ({
    page,
  }) => {
    await page.goto("/library");
    const cards = page.locator("[data-card]");
    await expect(cards).toHaveCount(5);
    const episode = page.locator('[data-card][data-kind="episode"]', {
      hasText: "Quiet interfaces and fast latency",
    });
    await expect(episode.locator(".card-title")).toHaveText("Quiet interfaces and fast latency");
    await expect(episode.locator(".card-facts")).toHaveText("Discussion, 5 min");
    await expect(
      page
        .locator('[data-card][data-kind="episode"]', { hasText: "AI headlines" })
        .locator(".card-facts"),
    ).toHaveText("Headlines, 3 min");

    await expect(page.getByRole("button", { name: "Episodes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.getByRole("button", { name: "Episodes" }).click();
    await expect(page.getByRole("button", { name: "Episodes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(2);
    await expect(page.locator("[data-library-status]")).toHaveText("2 of 5 results");

    // The other filters leave episodes out.
    await page.getByRole("button", { name: "Daily" }).click();
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(2);
    await expect(page.locator('[data-card][data-kind="episode"]:not([hidden])')).toHaveCount(0);

    // Search finds an episode by a story it covers.
    await page.getByRole("button", { name: "All" }).click();
    // Search finds an episode by its title, on one line like a story.
    await page.getByRole("searchbox").fill("interfaces and fast");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(1);
    await expect(page.locator("[data-card]:not([hidden])")).toHaveAttribute("data-kind", "episode");
    await page.getByRole("searchbox").fill("no such story");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
    await expect(page.locator("[data-library-empty]")).toBeVisible();
  });

  test("open the episode page from a card", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("link", { name: /Quiet interfaces and fast latency/ }).click();
    await expect(page).toHaveURL(new RegExp(`${EPISODE}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Quiet interfaces and fast latency",
    );
    await expect(page.locator('.app-nav-item[aria-current="page"]')).toHaveText("Library");
  });
});

test.describe("an episode page", () => {
  test("shows the title, a quiet line, the play chip and the script with its two hosts", async ({
    page,
  }) => {
    await page.goto(EPISODE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Quiet interfaces and fast latency",
    );
    await expect(page.locator(".hero .meta > span")).toHaveText([
      "Discussion",
      "5 min",
      "7 October",
    ]);
    await expect(page.locator(".hero .cover img")).toHaveAttribute(
      "srcset",
      new RegExp(EPISODE_ID),
    );
    await expect(page.locator("[data-play-digest]")).toHaveAttribute(
      "data-play-digest",
      EPISODE_ID,
    );

    const turns = page.locator(".episode-turn");
    await expect(turns).toHaveCount(7);
    await expect(turns.nth(0).locator(".episode-speaker")).toHaveText("Host");
    await expect(turns.nth(1).locator(".episode-speaker")).toHaveText("Guest");
    await expect(turns.nth(1)).toContainText("Start with emphasis.");
    // The name is medium weight and the words are regular.
    const weights = await turns.nth(1).evaluate((turn) => ({
      name: getComputedStyle(turn.querySelector(".episode-speaker") as Element).fontWeight,
      words: getComputedStyle(turn).fontWeight,
    }));
    expect(Number(weights.name)).toBeGreaterThan(Number(weights.words));
  });

  test("links to each source story, opening it in a new tab", async ({ page }) => {
    await page.goto(EPISODE);
    const rows = page.locator(".episode-sources a");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute(
      "href",
      "https://example.com/dispatch-fixture/f0a17c2d6b83",
    );
    await expect(rows.nth(0)).toHaveAttribute("target", "_blank");
    await expect(rows.nth(0)).toHaveAttribute("rel", "noopener noreferrer");
    await expect(rows.nth(0).locator(".episode-source-title")).toHaveText(
      "Why a quiet interface needs one loud detail",
    );
    await expect(rows.nth(0).locator(".episode-source-meta")).toHaveText("Margin Notes");
  });

  test("hands the player the data a briefing hands it: the episode, its stories, one section", async ({
    page,
  }) => {
    await page.goto(EPISODE);
    const data = await page.locator("#dispatch-digest-data").evaluate((node) => {
      return JSON.parse(node.textContent ?? "null");
    });
    expect(data).toMatchObject({
      id: EPISODE_ID,
      title: "Quiet interfaces and fast latency",
      audio: null,
      sections: [{ slug: "top", title: "Stories" }],
    });
    expect(data.items.map((item: { id: string }) => item.id)).toEqual([
      "f0a17c2d6b83",
      "6d3b8e0f94a1",
    ]);
  });

  test("a single-host episode shows no speaker names", async ({ page }) => {
    await page.goto("/e/ep-20261006-0900");
    await expect(page.locator(".episode-turn")).toHaveCount(1);
    await expect(page.locator(".episode-speaker")).toHaveCount(0);
  });
});

test.describe("axe, the Create page and episodes", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`Create has no WCAG 2.2 AA violations, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openCreate(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });

    test(`Create with a topic chosen and an error showing has none, ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openCreate(page);
      await page.locator("[data-submit]").click();
      await expect(page.locator('[data-error="topics"]')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await chip(page, "Trending").click();
      await chip(page, "Design Engineering").click();
      await page.waitForTimeout(300);
      expect(await violations(page)).toEqual([]);
    });

    test(`an episode page has none, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(EPISODE);
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });

    test(`the Library with episodes has none, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/library");
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });
  }
});

test.describe("axe, the passphrase dialog", () => {
  test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);

  // The dialog shows a 401, which the browser logs as a failed load.
  test.use({ allowNetworkErrors: true });

  for (const scheme of ["light", "dark"] as const) {
    test(`the passphrase dialog, with its error, has none, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockPodcast(page, 401, { status: 401, error: "wrong_passphrase" });
      await openCreate(page);
      await openDialog(page);
      await dialog(page).getByLabel("Passphrase").fill("nope");
      await dialog(page).getByRole("button", { name: "Create episode" }).click();
      await expect(dialog(page).getByRole("alert")).toBeVisible();
      await page.waitForTimeout(400);
      expect(await violations(page)).toEqual([]);
    });
  }
});

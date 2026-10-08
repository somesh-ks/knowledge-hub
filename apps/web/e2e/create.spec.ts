import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PASSPHRASE = "correct horse battery staple";
const STORAGE_KEY = "dispatch:narrate-passphrase";
const EPISODE = "/e/ep-20261007-1930";
const EPISODE_ID = "ep-20261007-1930";
const STARTED = "Your episode is being built. It appears in the Library in a few minutes.";

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

const chip = (page: Page, name: string) => page.locator(".create-chip", { hasText: name });
const segment = (page: Page, name: string) => page.locator(".settings-segment", { hasText: name });
const option = (page: Page, name: string) => page.locator(".create-option", { hasText: name });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Enter the passphrase" });
const estimate = (page: Page) => page.locator("[data-estimate]");

/** Opens the page and waits for its script, which is what makes the form do anything. */
async function openCreate(page: Page): Promise<void> {
  await page.goto("/create");
  await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
}

/** Chooses two topics and opens the passphrase dialog. */
async function openDialog(page: Page): Promise<void> {
  await chip(page, "Top picks").click();
  await chip(page, "Research").click();
  await page.locator("[data-submit]").click();
  await expect(dialog(page)).toBeVisible();
}

test.describe("the Create page", () => {
  test("shows no error line, and no part of one, before anything has gone wrong", async ({
    page,
  }) => {
    await openCreate(page);
    // Hidden in the DOM is not enough: a display rule on the line once showed its icon anyway.
    for (const line of await page.locator("[data-error]").all()) await expect(line).toBeHidden();
    await expect(page.locator("[data-run-working], [data-run-done]").first()).toBeHidden();
  });

  test("introduces itself in two lines and offers every choice", async ({ page }) => {
    await openCreate(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create a podcast");
    await expect(page.locator(".create-lede")).toHaveText(
      "Pick topics and a length. Singularity writes and reads an episode from the last few days of stories.",
    );
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Topics",
      "Length",
      "Format",
      "Look back",
      "Tone",
      "Title",
    ]);
    // The topics are the sections the published briefings actually have.
    await expect(page.locator(".create-chip")).toHaveText([
      "Top picks",
      "Interaction craft",
      "AI models and products",
      "Research",
      "Launches",
      "Watch and listen",
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
    await chip(page, "AI models and products").click();
    await expect(error).toBeHidden();
  });

  test("counts the topics, and stops at six", async ({ page }) => {
    await openCreate(page);
    await expect(page.locator("#create-topics-hint")).toHaveText(
      "Choose up to 6. None chosen yet.",
    );
    await chip(page, "Top picks").click();
    await expect(page.locator("#create-topics-hint")).toHaveText("Choose up to 6. 1 chosen.");
    for (const name of [
      "Interaction craft",
      "AI models and products",
      "Research",
      "Launches",
      "Watch and listen",
    ]) {
      await chip(page, name).click();
    }
    await expect(page.locator("#create-topics-hint")).toHaveText("Choose up to 6. 6 chosen.");
    await chip(page, "Launches").click();
    await expect(page.locator("#create-topics-hint")).toHaveText("Choose up to 6. 5 chosen.");
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

  test("asks for the passphrase in a dialog that can be cancelled", async ({ page }) => {
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

    await chip(page, "Top picks").click();
    await chip(page, "Research").click();
    await segment(page, "10 min").click();
    await option(page, "Discussion").click();
    await segment(page, "A month").click();
    await segment(page, "Dry").click();
    await page.getByLabel("Title").fill("  My week in AI  ");
    await page.locator("[data-submit]").click();

    await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
    await dialog(page).getByRole("button", { name: "Create episode" }).click();

    // The request is exactly what was chosen, and the passphrase rides beside it.
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]).toEqual({
      passphrase: PASSPHRASE,
      request: {
        topic_ids: ["top", "research"],
        length_minutes: 10,
        format: "discussion",
        window_days: 30,
        tone: "dry",
        title: "My week in AI",
      },
    });

    // The form gives way to the progress, which says so in words.
    const run = page.locator("[data-run]");
    await expect(run).toBeVisible();
    await expect(page.locator("[data-create-form]")).toBeHidden();
    await expect(run).toContainText("Writing your episode");
    await expect(page.locator("[data-run-hint]")).toHaveText("Waiting to start.");

    await page.clock.runFor(4000);
    await expect(page.locator("[data-run-hint]")).toHaveText("Waiting to start.");
    await page.clock.runFor(4000);
    await expect(page.locator("[data-run-hint]")).toHaveText(
      "Reading the stories and writing the script.",
    );
    await page.clock.runFor(4000);
    await expect(page.locator("[data-run-result]")).toHaveText(STARTED);
    await expect(page.locator("[data-run-working]")).toBeHidden();
    expect(asked).toEqual(["4242", "4242", "4242"]);
    await expect(page.getByRole("link", { name: "Go to the Library" })).toHaveAttribute(
      "href",
      "/library",
    );

    // Another episode brings the form back.
    await page.getByRole("button", { name: "Create another" }).click();
    await expect(page.locator("[data-create-form]")).toBeVisible();
    await expect(run).toBeHidden();
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
    await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(page.locator("[data-run]")).toBeVisible();
    await page.clock.runFor(4000);
    await expect(page.locator("[data-run-result]")).toHaveText(
      "The episode could not be written. Nothing was added to the Library. Try again later.",
    );
  });
});

test.describe("the Create page when the server says no", () => {
  // A 4xx or a dropped request is logged by the browser as a failed load; here it is the point.
  test.use({ allowNetworkErrors: true });

  test("leaves the title out when it is empty, and sends no title key", async ({ page }) => {
    const mock = await mockPodcast(page, 400, { status: 400, error: "invalid_request" });
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toEqual({
      topic_ids: ["top", "research"],
      length_minutes: 5,
      format: "readout",
      window_days: 7,
      tone: "neutral",
    });
  });

  test("says a wrong passphrase in words and keeps the dialog open", async ({ page }) => {
    await mockPodcast(page, 401, { status: 401, error: "wrong_passphrase" });
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByLabel("Passphrase").fill("not it");
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "That passphrase does not match. Check it and try again.",
    );
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator("[data-run]")).toBeHidden();
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
    await chip(page, "Top picks").click();
    for (const [status, body, words] of cases) {
      await page.unroute("**/api/podcast");
      await mockPodcast(page, status, body);
      await page.locator("[data-submit]").click();
      await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
      await dialog(page).getByRole("button", { name: "Create episode" }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(page.locator('[data-error="form"]')).toHaveText(words);
      await expect(page.locator("[data-create-form]")).toBeVisible();
    }
  });

  test("says so when the request cannot be sent", async ({ page }) => {
    await page.route("**/api/podcast", (route) => route.abort("failed"));
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(page.locator('[data-error="form"]')).toHaveText(
      "The request did not go through. Check your connection, then try again.",
    );
  });

  test("keeps the passphrase on this device only when asked, and offers it next time", async ({
    page,
  }) => {
    await mockPodcast(page, 202, { status: 202, run_id: 7, started_at: "2026-10-07T12:00:00Z" });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
    );
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
    await dialog(page).getByLabel("Remember on this device").check();
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(page.locator("[data-run]")).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(PASSPHRASE);

    // A page that cannot follow the run still says the episode was started.
    await expect(page.locator("[data-run-result]")).toHaveText(STARTED, { timeout: 15_000 });

    await page.reload();
    await openDialog(page);
    await expect(dialog(page).getByLabel("Passphrase")).toHaveValue(PASSPHRASE);
    await expect(dialog(page).getByLabel("Remember on this device")).toBeChecked();
  });
});

test.describe("navigation with four destinations", () => {
  test("fits at 320px, every item a full target, and marks Create as current", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openCreate(page);
    const items = page.locator(".app-nav-item");
    await expect(items).toHaveText(["Today", "Library", "Create", "Settings"]);
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
      // Each of the four gets about a quarter of the bar and is at least 44px each way.
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.textWidth).toBeLessThanOrEqual(box.width);
      expect(box.clipped).toBe(false);
    }
    // The four do not overlap.
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index]?.left ?? 0).toBeGreaterThanOrEqual((boxes[index - 1]?.right ?? 0) - 0.5);
    }
    await expect(page.locator('.app-nav-item[aria-current="page"]')).toHaveText("Create");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });

  test("goes to Create from the navigation", async ({ page }) => {
    await page.goto("/library");
    await page.locator(".app-nav-item", { hasText: "Create" }).click();
    await expect(page).toHaveURL(/\/create$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create a podcast");
    await expect(page.locator('.app-nav-item[aria-current="page"]')).toHaveText("Create");
    // And back, with no script blocked on the way: the page script survives client navigation.
    await page.locator(".app-nav-item", { hasText: "Library" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await page.locator(".app-nav-item", { hasText: "Create" }).click();
    await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
    await chip(page, "Research").click();
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
      await chip(page, "Research").click();
      await chip(page, "Top picks").click();
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

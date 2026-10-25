import type { Page, Route } from "@playwright/test";
import { DEFAULT_SCHEDULE } from "@singularity/core";
import { configHash } from "../src/lib/configHash";
import { BUILT_FILES, routeConfigStore } from "./configServer";
import { expect, expectNoViolationsInEitherScheme, seedStorage, test } from "./fixtures";
import { choose, openPicker, pickerList } from "./picker";

const EPISODE = "/e/ep-20261007-1930";
const EPISODE_ID = "ep-20261007-1930";

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

const chip = (page: Page, name: string) => page.locator(".filter-chip:visible", { hasText: name });
const segment = (page: Page, name: string) => page.getByRole("radio", { name, exact: true });
const submit = (page: Page) => page.locator("[data-submit]");

/** Unticks every chip, for a test that starts from no topic. */
async function clearTopics(page: Page): Promise<void> {
  const checked = page.locator('input[name="topic"]:checked');
  for (let left = await checked.count(); left > 0; left -= 1) {
    await checked.first().locator("xpath=..").click();
    await expect(checked).toHaveCount(left - 1);
  }
  await expect(page.locator('input[name="topic"]:checked')).toHaveCount(0);
}

/** Opens More options (format, voice, tone) unless it is already open. */
async function openMore(page: Page): Promise<void> {
  const more = page.locator("[data-create-more]").first();
  if (!(await more.evaluate((details) => (details as HTMLDetailsElement).open))) {
    await more.locator("summary").click();
  }
  await expect(more).toHaveAttribute("open", "");
}

/**
 * Opens the page and waits for its script, which is what makes the form do anything. More options
 * is opened too, so every choice can be pressed; a test of the closed row opens the page itself.
 */
async function openCreate(page: Page): Promise<void> {
  await page.goto("/create");
  await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
  // The voices are lists with a search box once their script has run.
  await expect(page.locator("[data-create-form]")).toHaveAttribute("data-pickers", "");
  await openMore(page);
}

// The service worker answers /latest.json itself, which a route handler cannot see.
test.use({ serviceWorkers: "block" });

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

  test("while the request is out the button says Starting…, with its spinner", async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/podcast", async (route) => {
      await held;
      // Accepted without a run to follow: the form says it did not start, with no failed request.
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: 202 }),
      });
    });
    await openCreate(page);
    await submit(page).click();
    const words = page.locator("[data-submit-text]");
    await expect(words).toHaveText("Starting…");
    await expect(submit(page)).toHaveAttribute("aria-busy", "true");
    await expect(submit(page).locator(".spinner")).toBeVisible();
    release();
    await expect(page.locator('[data-error="form"]')).toBeVisible();
    await expect(words).toHaveText("Generate catch up");
    await expect(submit(page).locator(".spinner")).toBeHidden();
  });

  test("needs at least one topic before it sends", async ({ page }) => {
    await openCreate(page);
    await clearTopics(page);
    const error = page.locator('[data-error="topics"]');
    await expect(error).toBeHidden();
    await page.locator("[data-submit]").click();
    await expect(error).toBeVisible();
    await expect(error).toHaveText("Pick at least one topic.");
    // Focus goes to the first topic, where the fix is.
    await expect(page.locator('input[name="topic"]').first()).toBeFocused();
    // Choosing one clears the message.
    await chip(page, "AI").click();
    await expect(error).toBeHidden();
  });

  test("chips ticked by hand mix both kinds of topic, and the episode is written for the owner", async ({
    page,
  }) => {
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 3, started_at: "x" });
    await openCreate(page);
    await chip(page, "World").click();
    await chip(page, "Sports").click();
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(6);
    await page.locator("[data-submit]").click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    // Design sends two sections; with Written for retired every script is the owner's.
    expect(mock.bodies[0]?.request).toMatchObject({
      audience: "custom",
      topic_ids: ["ai", "design", "ui-craft", "software", "sports", "tech", "world"],
    });
  });

  test("More options is one closed row that names its choices, and opens in place", async ({
    page,
  }) => {
    await page.goto("/create");
    await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
    const more = page.locator("[data-create-more]");
    await expect(more).not.toHaveAttribute("open", "");
    await expect(page.locator("[data-more-values]")).toHaveText("Readout · Neutral tone");
    await expect(page.locator('input[name="tone"]').first()).toBeHidden();
    // The title, the topics, the length and the look back are the questions; nothing says who the
    // episode is written for any more.
    await expect(page.getByRole("radiogroup", { name: "Written for" })).toHaveCount(0);
    await expect(page.getByLabel("Title")).toBeVisible();
    await expect(segment(page, "7 days")).toBeVisible();
    await more.locator("summary").click();
    await segment(page, "Energetic").click();
    await segment(page, "Discussion").click();
    await more.locator("summary").click();
    await expect(page.locator("[data-more-values]")).toHaveText("Discussion · Energetic tone");
    // The three tones that were offered are two: Dry is gone.
    await expect(segment(page, "Dry")).toHaveCount(0);
  });

  test("a wide page keeps More options open beside the main questions", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.goto("/create");
    await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
    const more = page.locator("[data-create-more]");
    await expect(more).toHaveAttribute("data-pinned", "");
    await more.locator("summary").click();
    await expect(more).toHaveAttribute("open", "");
    // The whole form is in view: Generate needs no scrolling.
    await expect(submit(page)).toBeInViewport();
  });

  test("a wide page's Tab goes down the main questions to Generate, then the options", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.goto("/create");
    await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
    const summary = page.locator("[data-create-more] > summary");
    // The pinned row is the column's heading, not a disclosure that does nothing.
    await expect(summary).toHaveAttribute("tabindex", "-1");
    await expect(page.getByRole("heading", { name: "More options", level: 2 })).toBeVisible();
    // The look back's chosen segment, the last main question, then Tab: Generate, then the first
    // choice under More options (the format).
    await page.locator('input[name="window"]:checked').focus();
    await page.keyboard.press("Tab");
    await expect(submit(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('input[name="format"]:checked')).toBeFocused();
    // Narrow again, the row is a switch in the Tab order, before Generate.
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(summary).not.toHaveAttribute("tabindex", "-1");
    const order = await page.evaluate(() => {
      const more = document.querySelector("[data-create-more]");
      return more?.nextElementSibling?.classList.contains("create-submit");
    });
    expect(order).toBe(true);
  });

  // Bug it prevents: a press that opened a passphrase dialog, or sent one, after D160 removed it.
  test("Create sends straight away and asks for nothing", async ({ page }) => {
    // The clock is held, so the page never gets as far as asking after the run.
    await page.clock.install();
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 5, started_at: "x" });
    await openCreate(page);
    // Visible text only: the form keeps every message it can show in its markup, hidden until used.
    await expect(page.getByText(/passphrase/i).filter({ visible: true })).toHaveCount(0);
    await page.locator("[data-submit]").click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]).not.toHaveProperty("passphrase");
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("sends the choices, then follows the run to the end", async ({ page }) => {
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

    // Design off, World on: the request mixes AI, Technology and Software Engineering with a
    // general topic.
    await chip(page, "Design").click();
    await chip(page, "World").click();
    await segment(page, "10 min").click();
    await segment(page, "Discussion").click();
    await segment(page, "30 days").click();
    await segment(page, "Energetic").click();
    await page.getByLabel("Title").fill("  My week in AI  ");
    await page.locator("[data-submit]").click();

    // The request is exactly what was chosen.
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]).toEqual({
      request: {
        audience: "custom",
        topic_ids: ["ai", "software", "tech", "world"],
        length_minutes: 10,
        format: "discussion",
        window_days: 30,
        tone: "energetic",
        voice_id: null,
        voice_id_b: null,
        title: "My week in AI",
      },
    });

    // The form stays; the progress is a line in the indicator, which says so in words.
    const card = page.locator("[data-run-card]");
    const text = page.locator("[data-run-text]");
    await expect(card).toBeVisible();
    await expect(page.locator("[data-create-form]")).toBeVisible();
    await expect(text).toHaveText("Episode queued");

    await page.clock.runFor(4000);
    await expect(text).toHaveText("Episode queued");
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

  test("names each stage, fills the bar, and waits for the new page", async ({ page }) => {
    await page.clock.install();
    await mockPodcast(page, 202, { status: 202, run_id: 7, started_at: "2026-10-07T12:00:00Z" });
    const stages = [
      { run_id: 7, state: "running", step: null, stage: 0, stages: 3, label: "Getting ready" },
      { run_id: 7, state: "running", step: null, stage: 1, stages: 3, label: "Making the episode" },
      {
        run_id: 7,
        state: "completed",
        step: null,
        stage: 2,
        stages: 3,
        label: "Adding it to your Library",
        outcome: "published",
      },
    ];
    let asked = 0;
    await page.route("**/api/status?**", (route) => {
      const body = stages[Math.min(asked, stages.length - 1)];
      asked += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    let live = false;
    await page.route(/latest.json/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          episode_at: live
            ? new Date(Date.now() + 3_600_000).toISOString()
            : "2020-01-01T00:00:00Z",
          episode_id: "ep-new",
        }),
      });
    });
    await openCreate(page);
    await submit(page).click();
    const text = page.locator("[data-run-text]");
    const card = page.locator("[data-run-card]");
    await expect(text).toHaveText("Episode queued");
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Getting ready");
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Making the episode");
    // The bar is a share of the whole, never past the start of the next stage.
    const share = () => card.evaluate((el) => Number(el.style.getPropertyValue("--run-to")));
    expect(await share()).toBeGreaterThanOrEqual(1 / 3);
    expect(await share()).toBeLessThan(2 / 3);
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Adding it to your Library");
    live = true;
    await expect(async () => {
      await page.clock.runFor(10_000);
      await expect(text).toHaveText("Episode ready", { timeout: 500 });
    }).toPass();
    await expect(page.locator("[data-run-library]")).toHaveAttribute("href", "/e/ep-new");
    await expect(page.locator("[data-run-library]")).toHaveText("Open episode");
  });

  // A failed run's line: the stage it stopped in when the status names one, and a plain failure
  // otherwise, never read as a started episode.
  const failures = [
    {
      status: { stage: 1, stages: 3, label: "Making the episode" },
      words: "Stopped while making the episode",
    },
    { status: {}, words: "Couldn't make the episode" },
  ];
  for (const { status, words } of failures) {
    test(`a failed run says "${words}"`, async ({ page }) => {
      await page.clock.install();
      await mockPodcast(page, 202, { status: 202, run_id: 8, started_at: "2026-10-07T12:00:00Z" });
      await page.route("**/api/status?**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            run_id: 8,
            state: "completed",
            step: null,
            outcome: "failed",
            ...status,
          }),
        }),
      );
      await openCreate(page);
      await submit(page).click();
      await expect(page.locator("[data-run-card]")).toBeVisible();
      await page.clock.runFor(4000);
      await expect(page.locator("[data-run-text]")).toHaveText(words);
      await expect(page.getByRole("link", { name: "Open Library" })).toBeHidden();
    });
  }

  test("a failed run offers Try again, which sends the same request and follows the new run", async ({
    page,
  }) => {
    await page.clock.install();
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 21, started_at: "x" });
    await page.route("**/api/status?**", (route) => {
      const run = Number(new URL(route.request().url()).searchParams.get("run"));
      const body =
        run === 21
          ? { run_id: 21, state: "completed", step: null, outcome: "failed" }
          : { run_id: run, state: "queued", step: null };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await openCreate(page);
    await segment(page, "10 min").click();
    await submit(page).click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    await page.clock.runFor(4000);
    const text = page.locator("[data-run-text]");
    await expect(text).toHaveText("Couldn't make the episode");
    const again = page.getByRole("button", { name: "Try again" });
    await expect(again).toBeVisible();
    // The second run gets an id of its own.
    await page.unroute("**/api/podcast");
    const second = await mockPodcast(page, 202, { status: 202, run_id: 22, started_at: "y" });
    await again.click();
    await expect.poll(() => second.bodies.length).toBe(1);
    expect(second.bodies[0]).toEqual(mock.bodies[0]);
    expect(second.bodies[0]?.request).toMatchObject({ length_minutes: 10 });
    await expect(text).toHaveText("Episode queued");
    await expect(again).toBeHidden();
    // It survives a reload: the stored run still holds the request.
    const stored = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("singularity:run") ?? "{}"),
    );
    expect(stored).toMatchObject({ id: 22, retry: { body: { request: mock.bodies[0]?.request } } });
  });

  test("while a run is going, Create says so and sends no second request", async ({ page }) => {
    await page.clock.install();
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 24, started_at: "x" });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ run_id: 24, state: "running", step: null }),
      }),
    );
    await openCreate(page);
    await submit(page).click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await submit(page).click();
    const busy = "An episode is still being made. You can start another when it's ready.";
    await expect(page.locator('[data-error="form"]')).toHaveText(busy);
    expect(mock.bodies).toHaveLength(1);
    // New episode says it too, to a screen reader, rather than opening a form that cannot send.
    await expect(page.locator("[data-create-open]").first()).toHaveAccessibleDescription(busy);
  });

  test("Episode ready goes once the episode is opened, and gives the room back", async ({
    page,
  }) => {
    await page.clock.install();
    await mockPodcast(page, 202, { status: 202, run_id: 25, started_at: "x" });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          run_id: 25,
          state: "completed",
          step: null,
          stage: 2,
          stages: 3,
          label: "Adding it to your Library",
          outcome: "published",
        }),
      }),
    );
    await page.route(/latest.json/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          episode_at: new Date(Date.now() + 3_600_000).toISOString(),
          episode_id: EPISODE_ID,
        }),
      }),
    );
    await openCreate(page);
    await submit(page).click();
    await page.clock.runFor(4000);
    await expect(async () => {
      await page.clock.runFor(3000);
      await expect(page.locator("[data-run-text]")).toHaveText("Episode ready", { timeout: 500 });
    }).toPass();
    await expect(page.locator("html")).toHaveAttribute("data-run", "done");
    await page.getByRole("link", { name: "Open episode" }).click();
    await expect(page).toHaveURL(new RegExp(`${EPISODE}$`));
    await expect(page.locator("[data-run-card]")).toBeHidden();
    await expect(page.locator("html")).not.toHaveAttribute("data-run", /.*/);
    expect(await page.evaluate(() => sessionStorage.getItem("singularity:run"))).toBeNull();
  });

  test("a finished run whose episode is on screen goes away by itself", async ({ page }) => {
    await seedStorage(page, {
      session: {
        "singularity:run": JSON.stringify({ id: 26, phase: "done", t0: Date.now(), href: EPISODE }),
      },
    });
    await page.goto("/library");
    await expect(page.locator("[data-run-text]")).toHaveText("Episode ready");
    await expect(page.locator("html")).toHaveAttribute("data-run", "done");
    await page.goto(EPISODE);
    await expect(page.locator("[data-run-card]")).toBeHidden();
    await expect(page.locator("html")).not.toHaveAttribute("data-run", /.*/);
  });
});

test.describe("the Create panel's voices", () => {
  test("a readout has one voice select, a discussion adds a second, and both are sent", async ({
    page,
  }) => {
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 7, started_at: "now" });
    await openCreate(page);
    const ada = page.locator("#create-voice");
    const leo = page.locator("#create-voice_b");
    await expect(ada).toHaveAccessibleName(/^Voice: /);
    // The voices are chosen from a list with a search box, and each can be heard from its button.
    await openPicker(page, ada);
    await expect(pickerList(page).getByRole("option")).toHaveText([
      "Default",
      /Ada/,
      /Leo/,
      /Nora/,
    ]);
    await pickerList(page).getByRole("combobox").fill("nora");
    await expect(pickerList(page).getByRole("option")).toHaveText([/Nora/]);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-voice=voice] [data-preview]")).toBeDisabled();
    await expect(ada).toBeVisible();
    await expect(leo).toBeHidden();
    await segment(page, "Discussion").click();
    await expect(leo).toBeVisible();
    // A discussion is two hosts, each with a voice, and the line under the format says so.
    await expect(page.locator("#create-voice-label")).toHaveText("Voices");
    await expect(ada).toHaveAccessibleName(/^Primary voice: /);
    await expect(leo).toHaveAccessibleName(/^Secondary voice: /);
    await choose(page, ada, /Ada, female/);
    await choose(page, leo, /Leo, male/);
    // The voices are labelled with the hosts' names (D76), in their captions and their names.
    await expect(page.locator("[data-voice-caption]")).toHaveText(["Ada's voice", "Leo's voice"]);
    await expect(ada).toHaveAccessibleName(/^Ada's voice: /);
    await expect(leo).toHaveAccessibleName(/^Leo's voice: /);
    await submit(page).click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toMatchObject({
      format: "discussion",
      voice_id: "voice-ada",
      voice_id_b: "voice-leo",
    });
  });

  test("Default names the voice it stands for, in each host's place", async ({ page }) => {
    await page.route("**/api/voices", (route) =>
      route.fulfill({
        json: {
          voices: [
            {
              id: "voice-ada",
              name: "Ada",
              gender: "female",
              language: "en-US",
              preview_url: null,
            },
            { id: "voice-leo", name: "Leo", gender: "male", language: "en-US", preview_url: null },
          ],
          defaults: { voice: "voice-ada", voice_b: "voice-leo" },
        },
      }),
    );
    await openCreate(page);
    const first = page.locator('select[name="voice"] option').first();
    await expect(first).toHaveText(/Default \(Ada\)/);
    await segment(page, "Discussion").click();
    await expect(page.locator('select[name="voice_b"] option').first()).toHaveText(
      /Default \(Leo\)/,
    );
  });

  test("a discussion's two hosts never share a voice: taking the other's hands this one over", async ({
    page,
  }) => {
    await page.route("**/api/voices", (route) =>
      route.fulfill({
        json: {
          voices: [
            {
              id: "voice-ada",
              name: "Ada",
              gender: "female",
              language: "en-US",
              preview_url: null,
            },
            { id: "voice-leo", name: "Leo", gender: "male", language: "en-US", preview_url: null },
            {
              id: "voice-nora",
              name: "Nora",
              gender: "female",
              language: "en-GB",
              preview_url: null,
            },
          ],
          defaults: { voice: "voice-ada", voice_b: "voice-leo" },
        },
      }),
    );
    await openCreate(page);
    await segment(page, "Discussion").click();
    const first = page.locator('select[name="voice"]');
    const second = page.locator('select[name="voice_b"]');
    // The lead takes Leo, whom the second host's Default stands for: the second host gets Ada.
    await choose(page, page.locator("#create-voice"), /Leo, male/);
    await expect(second).toHaveValue("voice-ada");
    // The button of the second host says so too: the list's words follow the page's value.
    await expect(page.locator("#create-voice_b")).toContainText("Ada");
    await expect(page.locator("[data-voice-caption]")).toHaveText(["Leo's voice", "Ada's voice"]);
    // The second host takes the lead's voice: they swap back.
    await choose(page, page.locator("#create-voice_b"), /Leo, male/);
    await expect(first).toHaveValue("voice-ada");
    // A third voice is nobody's: nothing else moves.
    await choose(page, page.locator("#create-voice_b"), /Nora, female/);
    await expect(first).toHaveValue("voice-ada");
    await expect(page.locator("[data-voice-caption]")).toHaveText(["Ada's voice", "Nora's voice"]);
  });

  test("a readout sends no second voice", async ({ page }) => {
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 7, started_at: "now" });
    await openCreate(page);
    await choose(page, page.locator("#create-voice"), /Nora, female/);
    await submit(page).click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    const request = mock.bodies[0]?.request as Record<string, unknown>;
    expect(request.voice_id).toBe("voice-nora");
    expect(request).not.toHaveProperty("voice_id_b");
  });
});

test.describe("the Create page when the server says no", () => {
  // A 4xx or a dropped request is logged by the browser as a failed load; here it is the point.
  test.use({ allowNetworkErrors: true });

  test("leaves the title out when it is empty, and sends no title key", async ({ page }) => {
    const mock = await mockPodcast(page, 400, { status: 400, error: "invalid_request" });
    await openCreate(page);
    await submit(page).click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toEqual({
      audience: "custom",
      topic_ids: ["ai", "design", "ui-craft", "software", "tech"],
      length_minutes: 5,
      format: "readout",
      window_days: 7,
      tone: "neutral",
      voice_id: null,
    });
  });

  test("names each refusal in words, on the page", async ({ page }) => {
    const cases: Array<[number | "abort", unknown, string]> = [
      [
        429,
        { status: 429, error: "cooldown", retry_after_s: 100 },
        "You can make another episode in 2 minutes.",
      ],
      [
        429,
        { status: 429, error: "daily_cap", retry_after_s: 3 * 3600 },
        "That's today's limit. Try again in 3 hours.",
      ],
      [
        503,
        { status: 503, error: "unavailable" },
        "The server ran into a problem, so no episode was started.",
      ],
      [
        400,
        { status: 400, error: "invalid_request" },
        "The server turned that request down. Reload the page and try again.",
      ],
      ["abort", null, "Couldn't reach the site. Check your connection, then try again."],
    ];
    await openCreate(page);
    for (const [status, body, words] of cases) {
      await page.unroute("**/api/podcast");
      if (status === "abort") await page.route("**/api/podcast", (route) => route.abort("failed"));
      else await mockPodcast(page, status, body);
      await page.locator("[data-submit]").click();
      await expect(page.locator('[data-error="form"]')).toHaveText(words);
      await expect(page.locator("[data-create-form]")).toBeVisible();
      await expect(page.locator("[data-run-card]")).toBeHidden();
    }
  });

  test("a Try again refused by the cooldown says how long to wait, in the line", async ({
    page,
  }) => {
    await page.clock.install();
    await mockPodcast(page, 202, { status: 202, run_id: 23, started_at: "x" });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          run_id: 23,
          state: "completed",
          step: null,
          stage: 1,
          stages: 3,
          label: "Making the episode",
          outcome: "failed",
        }),
      }),
    );
    await openCreate(page);
    await submit(page).click();
    await page.clock.runFor(4000);
    const text = page.locator("[data-run-text]");
    await expect(text).toHaveText("Stopped while making the episode");
    await page.unroute("**/api/podcast");
    await mockPodcast(page, 429, { status: 429, error: "cooldown", retry_after_s: 400 });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(text).toHaveText("You can make another episode in 7 minutes.");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

test.describe("navigation with three destinations and one action", () => {
  test("fits at 320px and marks the Library as current on Create", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openCreate(page);
    await expect(page.locator(".app-nav-item")).toHaveText(["Latest", "Library", "Settings"]);
    for (const item of await page.locator(".app-nav-item").all())
      await expect(item).toBeInViewport();
    // Create sits under the Library, where episodes are kept.
    await expect(page.locator('.app-nav-item[aria-current="page"]')).toHaveText("Library");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });

  test("below 64rem the Create page leads back to the Library", async ({ page }) => {
    await page.goto("/create");
    const back = page.locator(".app-bar-back");
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/library");
    await back.click();
    await expect(page).toHaveURL(/\/library$/);
  });
});

test.describe("an episode page", () => {
  test("shows the title, the play chip with the date, and the highlights", async ({ page }) => {
    await page.goto(EPISODE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Quiet interfaces and fast latency",
    );
    // The format and the story count stand under the title, as a briefing's facts (owner,
    // 2026-10-24); the length is the chip's label, said once.
    await expect(page.locator(".hero-text .hero-facts > span")).toHaveText([
      "Discussion",
      "2 stories",
    ]);
    await expect(page.locator('.hero .cover img[data-mode="light"]')).toHaveAttribute(
      "srcset",
      new RegExp(EPISODE_ID),
    );
    await expect(page.locator(".hero [data-play-digest]")).toHaveAttribute(
      "data-play-digest",
      EPISODE_ID,
    );
    // The script is read in the player, not on the page.
    await expect(page.locator(".episode-turn")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Script" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Stories" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Highlights" })).toBeVisible();
  });

  test("each highlight has its headline, what was said, and the link to the source", async ({
    page,
  }) => {
    await page.goto(EPISODE);
    const rows = page.locator(".episode-highlight");
    await expect(rows).toHaveCount(2);
    // The headline is the link to the source, named by its words, and says it opens a new tab.
    const link = rows.nth(0).locator(".episode-highlight-title a");
    await expect(link).toHaveAccessibleName(
      "Why a quiet interface needs one loud detail (opens in a new tab)",
    );
    // A story that is in a briefing reads as it does there: the briefing's summary, not the
    // hosts' segues ("Start with emphasis.").
    await expect(rows.nth(0).locator(".episode-highlight-text")).toHaveText(
      /^An essay on spending visual emphasis in one place/,
    );
    await expect(link).toHaveAttribute(
      "href",
      "https://example.com/singularity-fixture/f0a17c2d6b83",
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The publisher as attribution, as in a briefing, and never the name of the service that
    // found it. It is the same destination, so only the headline is in the tab order.
    const host = rows.nth(0).locator(".source-link");
    await expect(host.locator(":scope > span").first()).toHaveText("Margin Notes");
    await expect(host).toHaveAttribute(
      "href",
      "https://example.com/singularity-fixture/f0a17c2d6b83",
    );
    await expect(host).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("body")).not.toContainText("Exa discovery");
  });

  test("hands the player the data a briefing hands it: the episode, its stories, one section", async ({
    page,
  }) => {
    await page.goto(EPISODE);
    const data = await page.locator("#singularity-digest-data").evaluate((node) => {
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
});

test.describe("axe, the Create page and episodes", () => {
  test("Create, then Create with an error showing, has no WCAG 2.2 AA violations", async ({
    page,
  }) => {
    await openCreate(page);
    await expectNoViolationsInEitherScheme(page);
    await clearTopics(page);
    await page.locator("[data-submit]").click();
    await expect(page.locator('[data-error="topics"]')).toBeVisible();
    await expectNoViolationsInEitherScheme(page);
  });

  test("an episode page has none", async ({ page }) => {
    await page.goto(EPISODE);
    await expectNoViolationsInEitherScheme(page);
  });
});

test.describe("the Create page with the config store on", () => {
  // The bug (D173): the panel was drawn from the settings as built, so a topic added in Settings had
  // no chip and a voice or length chosen there was not what Generate sent, until the next deploy.
  test("starts from the settings as stored, and sends them", async ({ page, context, baseURL }) => {
    const topics = JSON.parse(BUILT_FILES["config/topics.json"] ?? "{}");
    const model = topics.topics[0];
    topics.topics.push({ ...model, id: "pottery", name: "Pottery", origin: "custom" });
    const custom = { ...DEFAULT_SCHEDULE.custom, length_minutes: 10, voice_id: "voice-stored" };
    await routeConfigStore(page, () => ({
      "config/topics.json": JSON.stringify(topics),
      "config/schedule.json": JSON.stringify({ ...DEFAULT_SCHEDULE, custom }),
    }));
    await context.addCookies([
      { name: "test-config-store", value: configHash(BUILT_FILES), url: `${baseURL}/` },
    ]);
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 9, started_at: "x" });
    await openCreate(page);
    await chip(page, "Pottery").click();
    await expect(submit(page)).toHaveText("Generate catch up");
    await submit(page).click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toMatchObject({
      length_minutes: 10,
      voice_id: "voice-stored",
      topic_ids: expect.arrayContaining(["pottery"]),
    });
  });
});

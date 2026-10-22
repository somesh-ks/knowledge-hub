import type { Page, Route } from "@playwright/test";
import { configHash } from "../src/lib/configHash";
import { GAP_MS } from "../src/scripts/managePageSave";
import { BUILT_FILES } from "./configServer";
import { expect, expectNoViolationsInEitherScheme, seedStorage, test } from "./fixtures";
import { choose, openPicker, pickerList } from "./picker";

interface Sent {
  passphrase: string;
  op: Record<string, unknown> | Record<string, unknown>[];
}

/** Answers /api/config and records what was sent. `answers` are used in order, then 202. */
async function mockConfig(page: Page, answers: Array<{ status: number; body: object }> = []) {
  const sent: Sent[] = [];
  await page.route("**/api/config", async (route: Route) => {
    sent.push(route.request().postDataJSON() as Sent);
    const answer = answers.shift() ?? { status: 202, body: { status: 202, run_id: 1 } };
    await route.fulfill({
      status: answer.status,
      contentType: "application/json",
      body: JSON.stringify(answer.body),
    });
  });
  return sent;
}

/** Every op sent, whether a request carried one or a list. */
const opsOf = (sent: Sent[]) =>
  sent.flatMap((request) => (Array.isArray(request.op) ? request.op : [request.op]));

/**
 * The schedule fields of every request sent, merged. Quick changes usually go in one request, but a
 * loaded machine can take longer than the pause between two of them; what reaches the repository is
 * the same either way.
 */
const scheduleSent = (sent: Sent[]) =>
  Object.assign({}, ...opsOf(sent).filter((op) => op.op === "schedule.set"));

type Leaf = "daily" | "weekly" | "voice";

async function open(page: Page, leaf: Leaf): Promise<void> {
  await page.goto(`/settings/${leaf}`);
  const root = page.locator("[data-manage]");
  await expect(root).toHaveAttribute("data-ready", "");
  // A podcast page loads its voices after the page is up.
  await expect(root).toHaveAttribute("data-voices", "");
  // The time zone and the voices are lists with a search box once their script has run.
  await expect(root).toHaveAttribute("data-pickers", "");
}

/** The Settings page, whose model select is filled once both live lists have been asked for. */
async function openSettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.locator("[data-manage]")).toHaveAttribute("data-loaded", "");
}

const toast = (page: Page) => page.locator("[data-bar]");
const toastText = (page: Page) => toast(page).locator("[data-bar-text]");
/** A save that went through shows no toast; a screen reader hears it. */
const spoken = (page: Page) => page.locator("[data-live]");
const SAVED = "Saved.";

test.describe("the Settings index", () => {
  test("lists one row per podcast page, each with what it holds now", async ({ page }) => {
    await page.goto("/settings");
    const rows = [
      ["Daily", "Every second day at 07:00", "/settings/daily"],
      ["Weekly", "Sundays at 07:00", "/settings/weekly"],
      ["Sources", "", "/settings/topics"],
      ["Preferences", "", "/settings/preferences"],
      ["Podcast voice", "Default voices", "/settings/voice"],
      ["Interface sounds", "On", "/settings/sounds"],
    ] as const;
    for (const [name, hint, href] of rows) {
      const row = page.getByRole("link", { name: new RegExp(`^${name}`) });
      await expect(row).toContainText(hint);
      await expect(row).toHaveAttribute("href", href);
    }
    // An episode on request is set up in the Create panel, so it has no page here.
    await expect(page.getByRole("link", { name: /^Custom/ })).toHaveCount(0);
  });

  test("a row leads to its page, whose title stands alone", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: /^Daily/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Daily Podcast" })).toBeVisible();
    await expect(page).toHaveTitle("Daily Podcast, Singularity");
  });

  test("no settings page has a breadcrumb or a way up above its title @desktop", async ({
    page,
  }) => {
    const ROUTES = [
      "/settings",
      "/settings/daily",
      "/settings/weekly",
      "/settings/voice",
      "/settings/sounds",
      "/settings/preferences",
      "/settings/topics",
      "/settings/topics/design",
      "/settings/topics/design?view=preferences",
      "/settings/blocked-outlets",
    ];
    for (const path of ROUTES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Breadcrumb" }), path).toHaveCount(0);
      // A link in the page before its title, leading to a page above this one.
      const up = await page.evaluate(() => {
        const title = document.querySelector("main h1");
        if (!title) return [];
        const here = location.pathname.replace(/\/$/, "");
        return [...document.querySelectorAll<HTMLAnchorElement>("main a[href]")]
          .filter((link) => link.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING)
          .filter((link) => link.checkVisibility())
          .map((link) => new URL(link.href).pathname.replace(/\/$/, ""))
          .filter((path) => path !== here && here.startsWith(`${path}/`));
      });
      expect(up, path).toEqual([]);
    }
  });

  test("the addresses of the old pages still land somewhere sensible", async ({ page }) => {
    const moves = [
      ["/settings/podcast", /\/settings$/],
      ["/settings/schedule", /\/settings\/daily$/],
      ["/settings/podcast/topics", /\/settings\/topics$/],
      ["/settings/sources", /\/settings\/topics$/],
      // An episode on request is set up in the Create panel.
      ["/settings/custom", /\/create$/],
    ] as const;
    for (const [old, now] of moves) {
      await page.goto(old);
      await expect(page).toHaveURL(now);
    }
  });
});

test.describe("the profile pages", () => {
  test("Daily shows its saved values", async ({ page }) => {
    await open(page, "daily");
    // Nothing is saved in the fixtures, so the defaults show.
    await expect(page.locator("#daily-hour")).toHaveValue("7");
    await expect(page.locator("#daily-hour option:checked")).toHaveText("07:00");
    // The time zone is a list with a search box; it names the zone and how far it is from Greenwich.
    await expect(page.locator("#daily-timezone")).toHaveText(/^Stockholm \(GMT\+[12]\)$/);
    await expect(page.locator("#daily-timezone-native")).toHaveValue("Europe/Stockholm");
    await expect(page.locator("#daily-cadence")).toHaveValue("2");
    await expect(page.locator("#daily-length")).toHaveValue("10");
    // The daily podcast has no type to set; Weekly keeps its Format.
    await expect(page.locator("#daily-format")).toHaveCount(0);
    // The voices are one pair for every podcast, on the Podcast voice page.
    await expect(page.getByLabel("Secondary voice", { exact: true })).toHaveCount(0);
  });

  test("Weekly is always on: it has no switch and its schedule shows", async ({ page }) => {
    await open(page, "weekly");
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.locator("#weekly-day")).toHaveValue("0");
    await expect(page.locator("#weekly-hour")).toHaveValue("7");
  });

  test("unticking every topic says the episode has nothing to cover", async ({ page }) => {
    await mockConfig(page);
    await open(page, "daily");
    const hint = page.getByText("No topics chosen, so Daily episodes have nothing to cover.");
    await expect(hint).toBeHidden();
    const chips = page.locator("input[data-scope]");
    for (let i = 0; i < (await chips.count()); i += 1) await chips.nth(i).uncheck({ force: true });
    await expect(hint).toBeVisible();
    await chips.first().check({ force: true });
    await expect(hint).toBeHidden();
  });

  test("both voices are rows of the Podcast voice page, filled from the voice list", async ({
    page,
  }) => {
    await open(page, "voice");
    const voices = [
      page.getByLabel("Primary voice", { exact: true }),
      page.getByLabel("Secondary voice", { exact: true }),
    ];
    for (const field of voices) {
      await expect(field).toBeVisible();
      await openPicker(page, field);
      await expect(pickerList(page).getByRole("option")).toHaveText([
        "Default",
        // Each voice leads with the flag of its accent: en-US, en-US, en-GB.
        "\u{1F1FA}\u{1F1F8} Ada, female",
        "\u{1F1FA}\u{1F1F8} Leo, male",
        "\u{1F1EC}\u{1F1E7} Nora, female",
      ]);
      // The search narrows the list by name, and by accent in words.
      await pickerList(page).getByRole("combobox").fill("british");
      await expect(pickerList(page).getByRole("option")).toHaveText([/Nora, female/]);
      await page.keyboard.press("Escape");
    }
    await expect(page.locator(".podcast-voice select")).toHaveCount(2);
  });

  test("each voice row has its own play button, which plays the chosen voice's sample", async ({
    page,
  }) => {
    await open(page, "voice");
    const first = page.locator("[data-voice-row=voice] [data-preview]");
    const second = page.locator("[data-voice-row=voice_b] [data-preview]");
    // Both buttons are on the page; a voice with no sample leaves its own dimmed and not pressable.
    await expect(first).toBeDisabled();
    await expect(second).toBeDisabled();
    // The page plays audio only from its own address, so the sample comes through /api.
    const sample = page.waitForRequest("**/api/voice-sample?voice=voice-ada");
    await choose(page, page.locator("#podcast-voice_b"), /Ada, female/);
    await sample;
    await expect(second).toBeEnabled();
    await expect(second).toHaveAccessibleName("Play a sample of the secondary voice");
    await expect(first).toBeDisabled();
    await choose(page, page.locator("#podcast-voice"), /Leo, male/);
    await expect(first).toBeDisabled();
    await expect(first).toHaveAccessibleName("No sample for the primary voice");
    await expect(second).toBeEnabled();
  });

  test("a playing sample stops when the page is left", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { pauses: number };
      w.pauses = 0;
      const pause = HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
        w.pauses += 1;
        return pause.call(this);
      };
    });
    await mockConfig(page);
    await open(page, "voice");
    const sample = page.waitForRequest("**/api/voice-sample?voice=voice-ada");
    await choose(page, page.locator("#podcast-voice"), /Ada, female/);
    await sample;
    await expect(spoken(page)).toHaveText(SAVED);
    const before = await page.evaluate(() => (window as unknown as { pauses: number }).pauses);
    await page.locator(".app-bar-back").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    // The app swaps the page in place, so the window, and the sample, live on: it must be paused.
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { pauses?: number }).pauses ?? 0).catch(() => 0),
      )
      .toBeGreaterThan(before);
  });

  test("the topics are chips, each one in the podcast or left out", async ({ page }) => {
    await open(page, "daily");
    const chips = page.locator(".podcast-topics .filter-chip");
    // Every topic is shown, and every one can be put in or out, the general news topics too.
    await expect(chips).toHaveText([
      "Design",
      "AI",
      "Technology",
      "Audio interfaces",
      "World",
      "Business",
      "Science",
      "Culture",
      "Sports",
    ]);
    for (const chip of await chips.all()) await expect(chip.locator("input")).toBeEnabled();
    // The fixtures leave nothing out, so the owner's topics are in.
    for (const chip of (await chips.all()).slice(0, 4)) {
      await expect(chip.locator("input")).toBeChecked();
    }
  });
});

test.describe("with the config store on", () => {
  // The bug (D149): Daily waited for the store before it read its starting point, and a change made
  // by key in that wait became the starting point itself, so it was never sent.
  test("a change made by key while the store is asked is still saved", async ({
    page,
    context,
    baseURL,
  }) => {
    const sent = await mockConfig(page);
    let answer: () => void = () => {};
    const asked = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.route("**/api/config", async (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await asked;
      await route.fulfill({
        json: {
          status: 200,
          built: configHash(BUILT_FILES),
          written_at: null,
          ops: [],
          sources: [],
        },
      });
    });
    await context.addCookies([
      { name: "test-config-store", value: configHash(BUILT_FILES), url: `${baseURL}/` },
    ]);
    await page.goto("/settings/daily");
    await page.locator("#daily-hour").selectOption("9");
    answer();
    await expect(page.locator("[data-manage]")).toHaveAttribute("data-ready", "");
    await expect.poll(() => scheduleSent(sent)).toEqual({ op: "schedule.set", hour: 9 });
  });
});

test.describe("saving on its own", () => {
  test("quick changes go a moment later, in one schedule.set with only what changed", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page);
    await open(page, "daily");
    await page.locator("#daily-hour").selectOption("9");
    await page.locator("#daily-cadence").selectOption("1");
    await page.locator("#daily-length").selectOption("15");
    await expect
      .poll(() => scheduleSent(sent))
      .toEqual({
        op: "schedule.set",
        hour: 9,
        cadence_days: 1,
        length_minutes: 15,
      });
    await expect(spoken(page)).toHaveText(SAVED);
    // Never more requests than changes, and each sends only what changed.
    expect(sent.length).toBeLessThanOrEqual(3);
    // Saved is the new starting point: putting the time back is a change again.
    const before = sent.length;
    await page.locator("#daily-hour").selectOption("7");
    // Held until the server's ten seconds between edits are up.
    await page.clock.runFor(3000);
    expect(sent.length).toBe(before);
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => sent.length).toBe(before + 1);
    expect(sent.at(-1)?.op).toEqual({ op: "schedule.set", hour: 7 });
  });

  for (const way of ["the app bar", "browser Back"] as const) {
    test(`a second change inside the server's gap still goes when the page is left by ${way}`, async ({
      page,
    }) => {
      await page.clock.install();
      const sent = await mockConfig(page);
      await page.goto("/settings");
      await page.getByRole("link", { name: /^Daily/ }).click();
      await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
      await page.locator("#daily-hour").selectOption("9");
      await expect(spoken(page)).toHaveText(SAVED);
      await page.locator("#daily-cadence").selectOption("1");
      expect(sent).toHaveLength(1);
      if (way === "browser Back") await page.goBack();
      else await page.locator(".app-bar-back").click();
      await expect(page).toHaveURL(/\/settings$/);
      // Until it goes, the index shows the change as it will be.
      await expect(page.getByRole("link", { name: /^Daily/ })).toContainText("Every day at 09:00");
      await page.clock.runFor(GAP_MS);
      await expect
        .poll(() => scheduleSent(sent))
        .toEqual({ op: "schedule.set", hour: 9, cadence_days: 1 });
      expect(sent).toHaveLength(2);
      await page.getByRole("link", { name: /^Daily/ }).click();
      await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
      await expect(page.locator("#daily-hour")).toHaveValue("9");
      await expect(page.locator("#daily-cadence")).toHaveValue("1");
      await expect(page.locator("[data-saved-note]")).toBeHidden();
    });
  }

  test("Weekly changes land in their own part of the schedule", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page, "weekly");
    await page.locator("#weekly-day").selectOption("5");
    await expect.poll(() => scheduleSent(sent)).toEqual({ op: "schedule.set", weekly: { day: 5 } });
    await expect(spoken(page)).toHaveText(SAVED);
  });

  // One pair reads every podcast (podcastVoices): it goes as the schedule's own voice, never a
  // profile's, and a reload before the build still shows it.
  test("a voice chosen on Podcast voice is sent as every podcast's voice and holds after a reload", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page, "voice");
    await choose(page, page.locator("#podcast-voice"), /Leo, male/);
    await expect
      .poll(() => scheduleSent(sent))
      .toEqual({ op: "schedule.set", voice_id: "voice-leo" });
    await expect(spoken(page)).toHaveText(SAVED);
    await page.reload();
    await open(page, "voice");
    await expect(page.locator("#podcast-voice")).toContainText("Leo");
    expect(opsOf(sent)).toHaveLength(1);
  });

  test("a topic chip puts the topics it stands for in or out of this podcast alone", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page);
    await open(page, "daily");
    await page.getByRole("checkbox", { name: "Audio interfaces" }).click({ force: true });
    await expect
      .poll(() => opsOf(sent))
      .toContainEqual({
        op: "topic.scope",
        ids: ["audio_interfaces"],
        daily: false,
      });
    await expect(spoken(page)).toHaveText(SAVED);
    // The weekly podcast has its own list: this chip said nothing of it.
    expect(opsOf(sent).some((op) => "weekly" in op)).toBe(false);
    // Saved is the new starting point: ticking it again is a change again.
    await page.getByRole("checkbox", { name: "Audio interfaces" }).click({ force: true });
    await page.clock.runFor(GAP_MS);
    await expect
      .poll(() => opsOf(sent).at(-1))
      .toEqual({
        op: "topic.scope",
        ids: ["audio_interfaces"],
        daily: true,
      });
  });

  test("says the time could not be changed when the token may not write variables", async ({
    page,
  }) => {
    await mockConfig(page, [
      { status: 202, body: { status: 202, run_id: 1, time_changed: false } },
    ]);
    await open(page, "daily");
    await page.locator("#daily-hour").selectOption("9");
    await expect(toastText(page)).toHaveText("Saved, except the time, which could not be changed.");
  });
});

test.describe("saved, before the build", () => {
  const KEY = "dispatch:saved-edits";
  const note = (page: Page) => page.locator("[data-saved-note]");

  test("a page opened again before the build shows what was saved, quietly, and sends nothing", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page);
    await open(page, "daily");
    const built = await page.locator("#daily-hour").inputValue();
    await expect(note(page)).toHaveCount(0);
    await page.locator("#daily-hour").selectOption("9");
    await page.getByRole("checkbox", { name: "Audio interfaces" }).click({ force: true });
    await expect(spoken(page)).toHaveText(SAVED);
    const before = sent.length;

    await page.reload();
    await open(page, "daily");
    expect(built).not.toBe("9");
    await expect(page.locator("#daily-hour")).toHaveValue("9");
    await expect(page.getByRole("checkbox", { name: "Audio interfaces" })).not.toBeChecked();
    await expect(note(page)).toHaveCount(0);
    // The saved values are the page's starting point: nothing goes again on its own.
    await page.clock.runFor(GAP_MS);
    expect(sent.length).toBe(before);
  });

  // The zone was saved and nothing read it (D89); filed under weekly, the server dropped it.
  test("a time zone chosen on Weekly is sent as the schedule's zone and shows on both pages after a reload", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page);
    await open(page, "weekly");
    await choose(page, page.locator("#weekly-timezone"), /^New York/);
    await page.clock.runFor(GAP_MS);
    await expect
      .poll(() => scheduleSent(sent))
      .toEqual({ op: "schedule.set", timezone: "America/New_York" });

    await page.reload();
    await open(page, "weekly");
    await expect(page.locator("#weekly-timezone-native")).toHaveValue("America/New_York");
    await open(page, "daily");
    await expect(page.locator("#daily-timezone")).toHaveText(/^New York \(GMT-[45]\)$/);
  });

  test("the index, the Topics list and Daily say what was saved on the other pages", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page);
    const ops = [
      { op: "schedule.set", hour: 9, voice_id: "leo_2", weekly: { day: 1 } },
      { op: "topic.remove", id: "audio_interfaces" },
      { op: "source.add", url: "https://pixel.example/feed.xml", topic_ids: ["product_design"] },
    ];
    const now = Date.now();
    await seedStorage(page, {
      local: { [KEY]: JSON.stringify([{ at: now, ops }]) },
    });
    await page.goto("/settings");
    const hint = (name: string) =>
      page.getByRole("link", { name: new RegExp(`^${name}`) }).locator("[data-hint]");
    await expect(hint("Daily")).toHaveText("Every second day at 09:00");
    await expect(hint("Weekly")).toHaveText("Mondays at 07:00");
    await expect(hint("Sources")).toHaveText("8 topics · 12 sources");
    await expect(hint("Podcast voice")).toHaveText("Leo and Default");

    await page.goto("/settings/topics");
    await expect(page.locator('a[data-page="design"] [data-hint]')).toHaveText("3 sources");
    await expect(page.locator('a[data-page="audio_interfaces"]')).toBeHidden();

    await open(page, "daily");
    // The removed topic has no chip.
    await expect(page.getByRole("checkbox", { name: "Audio interfaces" })).toBeHidden();
    // Nothing is sent on its own: no scope for the removed topic, no schedule again.
    await page.clock.runFor(GAP_MS);
    expect(sent).toEqual([]);
  });

  test("shows nothing once the build has the saved value, or once the edit is too old", async ({
    page,
  }) => {
    await mockConfig(page);
    await open(page, "daily");
    const built = await page.locator("#daily-hour").inputValue();
    // The build has landed: the page is built with what was saved.
    await page.evaluate(
      ([key, hour]) =>
        localStorage.setItem(
          key as string,
          JSON.stringify([{ at: Date.now(), ops: [{ op: "schedule.set", hour: Number(hour) }] }]),
        ),
      [KEY, built],
    );
    await page.reload();
    await open(page, "daily");
    await expect(note(page)).toHaveCount(0);
    // Saved four minutes ago: long enough for any build, so the page is believed.
    await page.evaluate(
      (key) =>
        localStorage.setItem(
          key,
          JSON.stringify([{ at: Date.now() - 4 * 60_000, ops: [{ op: "schedule.set", hour: 3 }] }]),
        ),
      KEY,
    );
    await page.reload();
    await open(page, "daily");
    await expect(page.locator("#daily-hour")).toHaveValue(built);
    await expect(note(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  });
});

test.describe("a refused save", () => {
  // The refusal is mocked, and the browser logs its 503 on the page's behalf.
  test.use({ allowNetworkErrors: true });

  test("a refused save says so, keeps the change, and Retry sends it again", async ({ page }) => {
    const sent = await mockConfig(page, [
      { status: 503, body: { status: 503, error: "unavailable" } },
    ]);
    await open(page, "daily");
    await page.locator("#daily-hour").selectOption("9");
    await expect(toastText(page)).toHaveText("The server ran into a problem. Not saved yet.");
    // One region speaks each message, an error through the alert region; the toast has no role.
    await expect(page.locator("[data-alert]")).toHaveText(
      "The server ran into a problem. Not saved yet.",
    );
    await expect(page.locator("[data-live]")).toHaveText("");
    await expect(toast(page)).not.toHaveAttribute("role", /.+/);
    await toast(page).getByRole("button", { name: "Retry" }).click();
    // A save that goes through takes the toast away and is only spoken: the control shows it.
    await expect(spoken(page)).toHaveText(SAVED);
    await expect(toast(page)).toBeHidden();
    await expect(page.locator("[data-alert]")).toHaveText("");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.op).toEqual({ op: "schedule.set", hour: 9 });
  });
});

test.describe("a change made offline", () => {
  test.use({ allowNetworkErrors: true });

  test("says it was not saved, and Retry sends it once the connection is back", async ({
    page,
    context,
  }) => {
    // A mocked route answers even while the context is offline, so the mock goes offline with it.
    let online = true;
    const sent: Sent[] = [];
    await page.route("**/api/config", async (route: Route) => {
      if (!online) {
        await route.abort("internetdisconnected");
        return;
      }
      sent.push(route.request().postDataJSON() as Sent);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: 202, run_id: 1 }),
      });
    });
    // The sending code is fetched at idle, while the connection is there.
    const sender = page.waitForResponse((response) => /managePageSave/.test(response.url()));
    await open(page, "daily");
    await sender;
    // Other idle fetches (the sheets) may still be on their way; going offline under them is a page
    // error of the test's making, not of the page's.
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    online = false;
    await page.locator("#daily-hour").selectOption("9");
    await expect(toastText(page)).toHaveText("Couldn't reach the site. Not saved yet.");
    expect(sent).toHaveLength(0);
    await context.setOffline(false);
    online = true;
    await toast(page).getByRole("button", { name: "Retry" }).click();
    await expect(spoken(page)).toHaveText(SAVED);
    expect(opsOf(sent)).toContainEqual({ op: "schedule.set", hour: 9 });
  });
});

test.describe("offline", () => {
  test.use({ allowNetworkErrors: true });

  const unavailable = (page: Page) =>
    page.route("**/api/models", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable" }),
      }),
    );
});

test("read with scripts off", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/settings/daily");
  await expect(page.locator("#daily-hour")).toHaveValue("7");
  await expect(
    page.locator("p.manage-note", { hasText: "Changing these settings needs JavaScript" }),
  ).toBeVisible();
  await context.close();
});

test.describe("axe", () => {
  test("the daily and weekly pages have no WCAG 2.2 AA violations", async ({ page }) => {
    // Four scans on one page load.
    test.setTimeout(60_000);
    for (const leaf of ["daily", "weekly"] as const) {
      await open(page, leaf);
      await expectNoViolationsInEitherScheme(page);
    }
  });

  test("none with the saving toast up", async ({ page }) => {
    await mockConfig(page);
    await open(page, "daily");
    await page.locator("#daily-hour").selectOption("9");
    await expect(spoken(page)).toHaveText(SAVED);
    await expectNoViolationsInEitherScheme(page);
  });
});

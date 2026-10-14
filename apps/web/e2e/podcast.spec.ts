import type { Page, Route } from "@playwright/test";
import { NEBIUS_TOP } from "../src/lib/modelId";
import { GAP_MS } from "../src/scripts/managePageSave";
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

type Leaf = "daily" | "weekly" | "model";

async function open(page: Page, leaf: Leaf): Promise<void> {
  await page.goto(`/settings/${leaf}`);
  const root = page.locator("[data-manage]");
  await expect(root).toHaveAttribute("data-ready", "");
  // The model page loads the live list, and a profile page its voices, after the page is up.
  if (leaf === "model") await expect(root).toHaveAttribute("data-loaded", "");
  else {
    await expect(root).toHaveAttribute("data-voices", "");
    // The time zone and the voices are lists with a search box once their script has run.
    await expect(root).toHaveAttribute("data-pickers", "");
  }
}

const toast = (page: Page) => page.locator("[data-bar]");
const toastText = (page: Page) => toast(page).locator("[data-bar-text]");
const combo = (page: Page) => page.getByRole("combobox", { name: "AI Model" });
/** The model select's options, or those under one heading: "Top models" or "All models". */
const options = (page: Page) => combo(page).getByRole("option");
const grouped = (page: Page, name: string) =>
  combo(page).locator(`optgroup[label="${name}"] option`);

const SAVED = "Saved. Live in about a minute.";

test.describe("the Settings index", () => {
  test("lists one row per podcast page, each with what it holds now", async ({ page }) => {
    await page.goto("/settings");
    const rows = [
      ["Daily", "Every second day at 07:00", "/settings/daily"],
      ["Weekly", "Sundays at 07:00", "/settings/weekly"],
      ["AI Model", "Nebius, Default", "/settings/model"],
    ] as const;
    for (const [name, hint, href] of rows) {
      const row = page.getByRole("link", { name: new RegExp(`^${name}`) });
      await expect(row).toContainText(hint);
      await expect(row).toHaveAttribute("href", href);
    }
    await expect(page.getByRole("link", { name: /^Topics and sources/ })).toHaveAttribute(
      "href",
      "/settings/topics",
    );
    // An episode on request is set up in the Create panel, so it has no page here.
    await expect(page.getByRole("link", { name: /^Custom/ })).toHaveCount(0);
  });

  test("a row leads to its page, whose title says where it sits", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: /^Daily/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Daily" })).toBeVisible();
    await expect(page).toHaveTitle("Daily, Singularity");
    const crumb = page.locator(".settings-up");
    await expect(crumb).toHaveText("Settings");
    await expect(crumb).toHaveAttribute("href", "/settings");
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
    await expect(page.getByRole("radio", { name: "10 min", exact: true })).toBeChecked();
    // Format and the Secondary voice are the profile's own, saved whatever the format is now.
    await expect(page.getByRole("radio", { name: "Readout" })).toBeChecked();
    await expect(page.getByLabel("Secondary voice", { exact: true })).toBeVisible();
    // Headlines is no longer offered, and there is no switch between profiles.
    await expect(page.getByRole("radio", { name: "Headlines" })).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "Podcast" })).toHaveCount(0);
  });

  test("Weekly is one switch while it is off", async ({ page }) => {
    await mockConfig(page);
    await open(page, "weekly");
    const on = page.getByRole("switch", { name: "Weekly podcast" });
    await expect(on).toBeChecked();
    await expect(page.locator("#weekly-day")).toHaveValue("0");
    await expect(page.locator("#weekly-hour")).toHaveValue("7");
    await expect(page.locator("[data-off]")).toBeHidden();
    const before = await on.boundingBox();
    await on.uncheck();
    await expect(page.locator("#weekly-day")).toBeHidden();
    await expect(page.getByRole("radio", { name: "10 min", exact: true })).toBeHidden();
    // The line that says it is off sits under the switch, so the switch holds still.
    await expect(page.locator("[data-off]")).toHaveText("No weekly episodes while this is off.");
    expect((await on.boundingBox())?.y).toBe(before?.y);
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

  test("both voices are rows under Episode, filled from the voice list", async ({ page }) => {
    await open(page, "daily");
    const episode = page.getByRole("region", { name: "Episode" });
    const voices = [
      episode.getByLabel("Primary voice", { exact: true }),
      episode.getByLabel("Secondary voice", { exact: true }),
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
    await open(page, "daily");
    const first = page.locator("[data-voice-row=voice] [data-preview]");
    const second = page.locator("[data-voice-row=voice_b] [data-preview]");
    // Both buttons are on the page; a voice with no sample leaves its own dimmed and not pressable.
    await expect(first).toBeDisabled();
    await expect(second).toBeDisabled();
    // The page plays audio only from its own address, so the sample comes through /api.
    const sample = page.waitForRequest("**/api/voice-sample?voice=voice-ada");
    await choose(page, page.locator("#daily-voice_b"), /Ada, female/);
    await sample;
    await expect(second).toBeEnabled();
    await expect(second).toHaveAccessibleName("Play a sample of the secondary voice");
    await expect(first).toBeDisabled();
    await choose(page, page.locator("#daily-voice"), /Leo, male/);
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
    await open(page, "daily");
    const sample = page.waitForRequest("**/api/voice-sample?voice=voice-ada");
    await choose(page, page.locator("#daily-voice"), /Ada, female/);
    await sample;
    await expect(toastText(page)).toHaveText(SAVED);
    const before = await page.evaluate(() => (window as unknown as { pauses: number }).pauses);
    await page.locator(".settings-up:visible, .app-bar-back:visible").first().click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    // The app swaps the page in place, so the window, and the sample, live on: it must be paused.
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { pauses?: number }).pauses ?? 0).catch(() => 0),
      )
      .toBeGreaterThan(before);
  });

  test("the topics are chips, each one in the podcast or left out, and Topics and sources is one tap away", async ({
    page,
  }) => {
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
    const link = page.getByRole("link", { name: /^Configure/ });
    await expect(link).toHaveAttribute("href", "/settings/topics");
    // A link row is as tall as the value rows, and its chevron ends at the row's edge.
    const [height, gap] = await link.evaluate((row) => {
      const box = row.getBoundingClientRect();
      const icon = row.querySelector(":scope > .icon")?.getBoundingClientRect();
      return [Math.round(box.height), Math.round(box.right - (icon?.right ?? 0))];
    });
    const timeRow = await page
      .locator(".settings-row:has(#daily-voice)")
      .evaluate((row) => Math.round(row.getBoundingClientRect().height));
    expect(Math.abs(gap)).toBeLessThanOrEqual(8);
    if ((page.viewportSize()?.width ?? 0) >= 640) expect(height).toBe(timeRow);
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
    await page.getByRole("radio", { name: "15 min" }).check();
    await page.getByRole("radio", { name: "Discussion" }).check();
    await choose(page, page.locator("#daily-voice_b"), /Leo, male/);
    await expect
      .poll(() => scheduleSent(sent))
      .toEqual({
        op: "schedule.set",
        hour: 9,
        cadence_days: 1,
        length_minutes: 15,
        format: "discussion",
        voice_id_b: "voice-leo",
      });
    await expect(toastText(page)).toHaveText(SAVED);
    // Never more requests than changes, and each sends only what changed.
    expect(sent.length).toBeLessThanOrEqual(3);
    // Saved is the new starting point: putting the time back is a change again.
    const before = sent.length;
    await page.locator("#daily-hour").selectOption("7");
    // Held until the server's ten seconds between edits are up, without a Saving in the meantime.
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
      await expect(toastText(page)).toHaveText(SAVED);
      await page.locator("#daily-cadence").selectOption("1");
      // Saved never stays up over a change not sent yet.
      await expect(toastText(page)).toHaveText("Saving");
      expect(sent).toHaveLength(1);
      if (way === "browser Back") await page.goBack();
      else await page.locator(".settings-up:visible, .app-bar-back:visible").first().click();
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
      await expect(page.locator("[data-saved-note]")).toHaveText(SAVED);
    });
  }

  test("Weekly changes land in their own part of the schedule", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page, "weekly");
    await page.locator("#weekly-day").selectOption("5");
    await page.getByRole("switch", { name: "Weekly podcast" }).uncheck();
    await expect
      .poll(() => scheduleSent(sent))
      .toEqual({ op: "schedule.set", weekly: { enabled: false, day: 5 } });
    await expect(toastText(page)).toHaveText(SAVED);
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
    await expect(toastText(page)).toHaveText(SAVED);
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
  const NOTE = SAVED;
  const KEY = "dispatch:saved-edits";
  const note = (page: Page) => page.locator("[data-saved-note]");

  test("a page opened again before the build shows what was saved, says so, and sends nothing", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page);
    await open(page, "daily");
    const built = await page.locator("#daily-hour").inputValue();
    await expect(note(page)).toHaveCount(0);
    await page.locator("#daily-hour").selectOption("9");
    await page.getByRole("checkbox", { name: "Audio interfaces" }).click({ force: true });
    await expect(toastText(page)).toHaveText(SAVED);
    const before = sent.length;

    await page.reload();
    await open(page, "daily");
    expect(built).not.toBe("9");
    await expect(page.locator("#daily-hour")).toHaveValue("9");
    await expect(page.getByRole("checkbox", { name: "Audio interfaces" })).not.toBeChecked();
    await expect(note(page)).toHaveText(NOTE);
    // The saved values are the page's starting point: nothing goes again on its own.
    await page.clock.runFor(GAP_MS);
    expect(sent.length).toBe(before);
    // The Weekly page was not changed and says nothing.
    await open(page, "weekly");
    await expect(note(page)).toHaveCount(0);
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
      { op: "schedule.set", hour: 9, weekly: { day: 1 } },
      { op: "topic.remove", id: "audio_interfaces" },
      { op: "source.add", url: "https://pixel.example/feed.xml", topic_ids: ["product_design"] },
    ];
    const now = Date.now();
    await seedStorage(page, {
      local: { [KEY]: JSON.stringify([{ at: now, ops }]) },
      session: {
        "dispatch:writer-pending": JSON.stringify({
          provider: "anthropic",
          model: "claude-haiku-5-5",
          timestamp: now,
        }),
      },
    });
    await page.goto("/settings");
    const hint = (name: string) =>
      page.getByRole("link", { name: new RegExp(`^${name}`) }).locator("[data-hint]");
    await expect(hint("Daily")).toHaveText("Every second day at 09:00");
    await expect(hint("Weekly")).toHaveText("Mondays at 07:00");
    await expect(hint("Topics and sources")).toHaveText("8 topics · 12 sources");
    await expect(hint("AI Model")).toHaveText("Anthropic, Claude Haiku 5.5");

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
    await expect(toastText(page)).toHaveText("Saving is not available right now. Not saved yet.");
    // One region speaks each message, an error through the alert region; the toast has no role.
    await expect(page.locator("[data-alert]")).toHaveText(
      "Saving is not available right now. Not saved yet.",
    );
    await expect(page.locator("[data-live]")).toHaveText("");
    await expect(toast(page)).not.toHaveAttribute("role", /.+/);
    await toast(page).getByRole("button", { name: "Retry" }).click();
    await expect(toastText(page)).toHaveText(SAVED);
    await expect(page.locator("[data-live]")).toHaveText(SAVED);
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
    await expect(toastText(page)).toHaveText("The site could not be reached. Not saved yet.");
    expect(sent).toHaveLength(0);
    await context.setOffline(false);
    online = true;
    await toast(page).getByRole("button", { name: "Retry" }).click();
    await expect(toastText(page)).toHaveText(SAVED);
    expect(opsOf(sent)).toContainEqual({ op: "schedule.set", hour: 9 });
  });
});

test.describe("the Model page", () => {
  test("lists Default, the top models the live list has, then the rest", async ({ page }) => {
    await open(page, "model");
    await expect(combo(page)).toHaveValue("");
    await expect(page.getByLabel("Provider")).toHaveValue("nebius");
    // The fixture list serves two of the top models; the others are left out.
    await expect(options(page)).toHaveCount(5);
    await expect(grouped(page, "Top models")).toHaveText([/^GLM-5\.3/, /^Kimi K3/]);
    await expect(grouped(page, "All models")).toHaveCount(2);
    await expect(options(page).filter({ hasText: /^Kimi K2\.6/ })).toHaveCount(0);
    await expect(toast(page)).toBeHidden();
  });

  test("a pick saves itself", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page, "model");
    // A top model is picked by its short name and saved by its id, as any live pick is.
    await combo(page).selectOption({ label: "Kimi K3" });
    await expect(toastText(page)).toHaveText(SAVED);
    expect(opsOf(sent)).toContainEqual({
      op: "writer.set",
      provider: "nebius",
      model: "moonshotai/Kimi-K3",
    });
  });

  test("a long list shows the top models first and leaves out the retired ones", async ({
    page,
  }) => {
    // Nebius's list on 2026-10-11 without three of the top models, as if they had been retired.
    const models = [
      ["MiniMaxAI/MiniMax-M3", 1048576],
      ["Qwen/Qwen3-235B-A22B-Instruct-2507", 262144],
      ["Qwen/Qwen3.5-397B-A17B", 262144],
      ["deepseek-ai/DeepSeek-V4-Pro-0813", 1002496],
      ["nvidia/Nemotron-3-Ultra-550b-a55b", 1048576],
      ["openai/gpt-oss-120b", 131072],
      ["zai-org/GLM-5.3", 1048576],
    ].map(([id, context_length]) => ({ id, context_length }));
    await page.route("**/api/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: "nebius", models }),
      }),
    );
    await open(page, "model");
    // Default, the three top models still served, in their order, and the four others.
    await expect(options(page)).toHaveCount(8);
    await expect(grouped(page, "Top models")).toHaveText([
      /^GLM-5\.3/,
      /^DeepSeek V4 Pro 0813/,
      /^Qwen3\.5 397B/,
    ]);
    await expect(grouped(page, "All models")).toHaveCount(4);
    await expect(options(page).filter({ hasText: /Kimi/ })).toHaveCount(0);
  });

  test("Anthropic offers the two Claude models, without asking for the live list", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page);
    await open(page, "model");
    let asked = 0;
    await page.route("**/api/models", (route) => {
      asked += 1;
      return route.abort();
    });
    await page.getByLabel("Provider").selectOption("anthropic");
    await expect(combo(page).locator("option:checked")).toHaveText("Claude Sonnet 5.5");
    await expect(options(page)).toHaveCount(2);
    expect(asked).toBe(0);
    await combo(page).selectOption({ label: "Claude Haiku 5.5" });
    // The pick waits out the server's gap after the provider's own save.
    await page.clock.runFor(GAP_MS);
    await expect
      .poll(() => opsOf(sent).at(-1))
      .toEqual({
        op: "writer.set",
        provider: "anthropic",
        model: "claude-haiku-5-5",
      });
    await expect(toastText(page)).toHaveText(SAVED);
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

  test("without the model list every top model is offered, and a pick saves itself", async ({
    page,
  }) => {
    await unavailable(page);
    const sent = await mockConfig(page);
    await open(page, "model");
    await expect(combo(page)).toHaveValue("");
    await expect(grouped(page, "Top models")).toHaveText(
      NEBIUS_TOP.map((model) => new RegExp(`^${model.label.replaceAll(".", "\\.")}`)),
    );
    await expect(options(page)).toHaveCount(NEBIUS_TOP.length + 1);
    await combo(page).selectOption({ label: "DeepSeek V4.1 Flash" });
    await expect(toastText(page)).toHaveText(SAVED);
    expect(opsOf(sent)).toEqual([
      { op: "writer.set", provider: "nebius", model: "deepseek-ai/DeepSeek-V4.1-Flash" },
    ]);
  });
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
  test("the daily, weekly and model pages have no WCAG 2.2 AA violations", async ({ page }) => {
    // Six scans on one page load.
    test.setTimeout(60_000);
    for (const leaf of ["daily", "weekly", "model"] as const) {
      await open(page, leaf);
      await expectNoViolationsInEitherScheme(page);
    }
  });

  test("none with the saving toast up", async ({ page }) => {
    await mockConfig(page);
    await open(page, "daily");
    await page.locator("#daily-hour").selectOption("9");
    await expect(toastText(page)).toHaveText(SAVED);
    await expectNoViolationsInEitherScheme(page);
  });

  test("none with the model list open in its groups", async ({ page }) => {
    await open(page, "model");
    await combo(page).click();
    await expect(grouped(page, "Top models").first()).toBeVisible();
    await expectNoViolationsInEitherScheme(page);
  });
});

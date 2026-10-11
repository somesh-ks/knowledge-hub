import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { NEBIUS_TOP } from "../src/lib/modelId";
import { expect, test } from "./fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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
  else await expect(root).toHaveAttribute("data-voices", "");
}

const toast = (page: Page) => page.locator("[data-bar]");
const toastText = (page: Page) => toast(page).locator("[data-bar-text]");
const combo = (page: Page) => page.getByRole("combobox", { name: "Model" });
const options = (page: Page, name?: RegExp) =>
  page.getByRole("listbox", { name: "Models" }).getByRole("option", name ? { name } : undefined);
/** The options under one heading of the open list: "Top models" or "All models". */
const grouped = (page: Page, name: string) =>
  page.getByRole("listbox", { name: "Models" }).getByRole("group", { name }).getByRole("option");

/** Types a query into the model field and picks the option that matches. */
async function pick(page: Page, query: string, name: RegExp): Promise<void> {
  await combo(page).fill(query);
  await options(page, name).click();
}

const SAVED = "Saved. Live in about a minute.";

test.describe("the Settings index", () => {
  test("lists one row per podcast page, each with what it holds now", async ({ page }) => {
    await page.goto("/settings");
    const rows = [
      ["Daily", "Every second day at 07:00", "/settings/daily"],
      ["Weekly", "Sundays at 07:00", "/settings/weekly"],
      ["Model", "Automatic", "/settings/model"],
    ] as const;
    for (const [name, hint, href] of rows) {
      const row = page.getByRole("link", { name: new RegExp(`^${name}`) });
      await expect(row).toContainText(hint);
      await expect(row).toHaveAttribute("href", href);
    }
    await expect(page.getByRole("link", { name: /^Topics & Sources/ })).toHaveAttribute(
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
    const crumb = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link");
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
  test("Daily shows its saved values, and the next briefing under the title", async ({ page }) => {
    await open(page, "daily");
    // Nothing is saved in the fixtures, so the defaults show.
    await expect(page.locator("#daily-hour")).toHaveValue("7");
    await expect(page.locator("#daily-hour option:checked")).toHaveText("07:00");
    await expect(page.locator("#daily-timezone")).toHaveValue("Europe/Stockholm");
    await expect(page.locator("#daily-cadence")).toHaveValue("2");
    await expect(page.getByRole("radio", { name: "Readout" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "10 min", exact: true })).toBeChecked();
    await expect(page.locator("[data-next]")).toHaveText(
      /^Next briefing: about (today|tomorrow|[A-Z][a-z]+day) at 07:00$/,
    );
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
    await expect(page.locator("[data-next]")).toHaveText(
      /^Next weekly: about (today|tomorrow|Sunday) at 07:00$/,
    );
    await expect(page.locator("[data-off]")).toBeHidden();
    const before = await on.boundingBox();
    await on.uncheck();
    await expect(page.locator("#weekly-day")).toBeHidden();
    await expect(page.getByRole("radio", { name: "Readout" })).toBeHidden();
    // The line under the title says it is off in the next run's place, so the switch holds still.
    await expect(page.locator("[data-next]")).toBeHidden();
    await expect(page.locator("[data-off]")).toHaveText("No weekly episode while it is off.");
    expect((await on.boundingBox())?.y).toBe(before?.y);
  });

  test("both voices are always there, filled from the voice list", async ({ page }) => {
    await open(page, "daily");
    const first = page.getByLabel("Voice", { exact: true });
    const second = page.getByLabel("Second voice", { exact: true });
    await expect(first).toBeVisible();
    await expect(first.locator("option")).toHaveText([
      "Default",
      // Each voice leads with the flag of its accent: en-US, en-US, en-GB.
      "\u{1F1FA}\u{1F1F8} Ada, female",
      "\u{1F1FA}\u{1F1F8} Leo, male",
      "\u{1F1EC}\u{1F1E7} Nora, female",
    ]);
    // The second voice is for discussions, and is set whatever the type is now.
    await expect(second).toBeVisible();
    await expect(page.getByText("Joins in discussions")).toBeVisible();
    await page.getByRole("radio", { name: "Discussion" }).check();
    await expect(second).toBeVisible();
    await page.getByRole("radio", { name: "Readout" }).check();
    await expect(second).toBeVisible();
  });

  test("choosing a voice with a sample plays it through the site and shows its play button", async ({
    page,
  }) => {
    await open(page, "daily");
    const play = page.locator("[data-voice-row=voice] [data-preview]");
    await expect(play).toBeHidden();
    // The page plays audio only from its own address, so the sample comes through /api.
    const sample = page.waitForRequest("**/api/voice-sample?voice=voice-ada");
    await page.locator("#daily-voice").selectOption("voice-ada");
    await sample;
    await expect(play).toBeVisible();
    await expect(play).toHaveAccessibleName("Play a sample of the voice");
    await page.locator("#daily-voice").selectOption("voice-leo");
    await expect(play).toBeHidden();
  });

  test("the topics are chips, each one in the podcast or left out, and Topics & Sources is one tap away", async ({
    page,
  }) => {
    await open(page, "daily");
    const chips = page.locator(".podcast-topics .filter-chip");
    await expect(chips).toHaveText(["Design", "AI", "Technology", "Audio interfaces"]);
    // The fixtures leave nothing out, so every topic is in.
    for (const chip of await chips.all()) await expect(chip.locator("input")).toBeChecked();
    // Only the owner's three and their own: general news plays in custom episodes alone.
    await expect(page.locator(".podcast-topics").getByText("World")).toHaveCount(0);
    const link = page.getByRole("link", { name: /^Topics & Sources/ });
    await expect(link).toHaveAttribute("href", "/settings/topics");
  });

  test("has 44px targets", async ({ page }) => {
    await open(page, "daily");
    for (const target of [
      page.locator("#daily-hour"),
      page.locator("#daily-cadence"),
      page.locator("#daily-voice"),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("saving on its own", () => {
  test("quick changes go a moment later, in one schedule.set with only what changed", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page, "daily");
    await page.locator("#daily-hour").selectOption("9");
    await page.locator("#daily-cadence").selectOption("1");
    await page.getByRole("radio", { name: "Discussion" }).check();
    await page.getByRole("radio", { name: "15 min" }).check();
    await expect
      .poll(() => scheduleSent(sent))
      .toEqual({
        op: "schedule.set",
        hour: 9,
        cadence_days: 1,
        format: "discussion",
        length_minutes: 15,
      });
    await expect(toastText(page)).toHaveText(SAVED);
    // Never more requests than changes, and each sends only what changed.
    expect(sent.length).toBeLessThanOrEqual(4);
    // Saved is the new starting point: putting the time back is a change again.
    const before = sent.length;
    await page.locator("#daily-hour").selectOption("7");
    // Held until the server's ten seconds between edits are up, without a Saving in the meantime.
    await page.waitForTimeout(3000);
    expect(sent.length).toBe(before);
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(before + 1);
    expect(sent.at(-1)?.op).toEqual({ op: "schedule.set", hour: 7 });
  });

  test("a change put back before it is sent sends nothing", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page, "daily");
    await page.locator("#daily-hour").selectOption("9");
    await page.locator("#daily-hour").selectOption("7");
    await page.getByRole("radio", { name: "Discussion" }).check();
    await page.getByRole("radio", { name: "Readout" }).check();
    await page.waitForTimeout(2000);
    expect(sent).toHaveLength(0);
    await expect(toast(page)).toBeHidden();
  });

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
    await expect
      .poll(() => opsOf(sent).at(-1), { timeout: 15_000 })
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
    await expect(toastText(page)).toHaveText(
      "Saved, except the time: the site's GitHub token needs permission to write repository variables.",
    );
  });
});

test.describe("saved, before the build", () => {
  const NOTE = "Saved. It takes effect after the next update, about a minute.";
  const KEY = "dispatch:saved-edits";
  const note = (page: Page) => page.locator("[data-saved-note]");

  test("a page opened again before the build shows what was saved, says so, and sends nothing", async ({
    page,
  }) => {
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
    await page.waitForTimeout(2000);
    expect(sent.length).toBe(before);
    // The Weekly page was not changed and says nothing.
    await open(page, "weekly");
    await expect(note(page)).toHaveCount(0);
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
          key,
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

test.describe("the Model page", () => {
  test("lists Automatic, the top models the live list has, then the rest", async ({ page }) => {
    await open(page, "model");
    await expect(combo(page)).toHaveValue("Automatic");
    await expect(page.getByLabel("Provider")).toHaveValue("nebius");
    await page.getByRole("button", { name: "Show all models" }).click();
    // The fixture list serves two of the top models; the others are left out.
    await expect(options(page)).toHaveCount(5);
    await expect(grouped(page, "Top models")).toHaveText([/^GLM-5\.3/, /^Kimi K3/]);
    await expect(grouped(page, "All models")).toHaveCount(2);
    await expect(options(page, /^Kimi K2\.6/)).toHaveCount(0);
    await expect(options(page, /^gpt-oss-120b/)).toContainText("openai, 128k context");
    await expect(toast(page)).toBeHidden();
  });

  test("reads as a select until pressed, then takes typing over the whole list", async ({
    page,
    isMobile,
  }) => {
    await open(page, "model");
    if (!isMobile) {
      await expect(combo(page)).toHaveCSS("cursor", "pointer");
    }
    await combo(page).click();
    await expect(combo(page)).toHaveAttribute("aria-expanded", "true");
    await expect(options(page)).toHaveCount(5);
    // The chosen name waits as a placeholder, so typing filters at once.
    await expect(combo(page)).toHaveValue("");
    await expect(combo(page)).toHaveAttribute("placeholder", "Automatic");
    if (!isMobile) await expect(combo(page)).toHaveCSS("cursor", "text");
    // A list opened with the pointer marks no row until a key is pressed.
    await expect(page.getByRole("listbox", { name: "Models" })).not.toHaveAttribute(
      "data-keyboard",
      "",
    );
    await page.keyboard.type("qwen");
    await expect(options(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(combo(page)).toHaveValue("Automatic");
  });

  test("typing filters the list and announces the count", async ({ page }) => {
    await open(page, "model");
    await combo(page).fill("QWEN");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page, /^Qwen3-235B/)).toBeVisible();
    await expect(page.locator("[data-count]")).toHaveText("1 model");
    await combo(page).fill("zzz");
    await expect(options(page)).toHaveCount(0);
    await expect(page.locator("[data-count]")).toHaveText("No models match");
  });

  test("the keyboard moves, picks and closes, and the pick saves itself", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page, "model");
    await combo(page).focus();
    await page.keyboard.press("ArrowDown");
    await expect(combo(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("listbox", { name: "Models" })).toHaveAttribute(
      "data-keyboard",
      "",
    );
    // A top model is picked by its short name and saved by its id, as any live pick is.
    await combo(page).fill("kimi");
    await page.keyboard.press("Enter");
    await expect(combo(page)).toHaveValue("Kimi K3");
    await expect(combo(page)).toHaveAttribute("aria-expanded", "false");
    await expect(toastText(page)).toHaveText(SAVED);
    expect(opsOf(sent)).toContainEqual({
      op: "writer.set",
      provider: "nebius",
      model: "moonshotai/Kimi-K3",
    });
    // Escape closes without choosing, and the field goes back to the chosen name.
    await combo(page).fill("qw");
    await expect(options(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(combo(page)).toHaveValue("Kimi K3");
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
    await page.getByRole("button", { name: "Show all models" }).click();
    // Automatic, the three top models still served, in their order, and the four others.
    await expect(options(page)).toHaveCount(8);
    await expect(grouped(page, "Top models")).toHaveText([
      /^GLM-5\.3/,
      /^DeepSeek V4 Pro 0813/,
      /^Qwen3\.5 397B/,
    ]);
    await expect(grouped(page, "All models")).toHaveCount(4);
    await expect(options(page, /Kimi/)).toHaveCount(0);
    // The headings are drawn, and each group keeps only what the query matches.
    await expect(page.getByText("Top models", { exact: true })).toBeVisible();
    await expect(page.getByText("All models", { exact: true })).toBeVisible();
    await combo(page).fill("qwen");
    await expect(page.locator("[data-count]")).toHaveText("2 models");
    await expect(grouped(page, "Top models")).toHaveText([/^Qwen3\.5 397B/]);
    await expect(grouped(page, "All models")).toHaveText([/^Qwen3-235B/]);
  });

  test("Anthropic offers the two Claude models, without asking for the live list", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page, "model");
    let asked = 0;
    await page.route("**/api/models", (route) => {
      asked += 1;
      return route.abort();
    });
    await page.getByLabel("Provider").selectOption("anthropic");
    await expect(combo(page)).toHaveValue("Claude Sonnet 5.5");
    await page.getByRole("button", { name: "Show all models" }).click();
    await expect(options(page)).toHaveCount(2);
    await expect(options(page, /^Claude Haiku 5\.5/)).toBeVisible();
    expect(asked).toBe(0);
    await page.keyboard.press("Escape");
    await pick(page, "haiku", /^Claude Haiku 5\.5/);
    // The provider's own save may still be showing Saved: wait for the pick's request itself.
    await expect
      .poll(() => opsOf(sent).at(-1))
      .toEqual({
        op: "writer.set",
        provider: "anthropic",
        model: "claude-haiku-5-5",
      });
    await expect(toastText(page)).toHaveText(SAVED);
  });

  test("going back to the saved provider before the save sends nothing", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page, "model");
    await page.getByLabel("Provider").selectOption("anthropic");
    await page.getByLabel("Provider").selectOption("nebius");
    await expect(combo(page)).toHaveValue("Automatic");
    await page.waitForTimeout(2000);
    expect(sent).toHaveLength(0);
  });

  test("the open list has equal padding above and below and stays on screen", async ({ page }) => {
    await open(page, "model");
    await combo(page).focus();
    await page.keyboard.press("ArrowDown");
    const list = page.getByRole("listbox", { name: "Models" });
    await expect(list).toBeVisible();
    const gaps = await list.evaluate((element) => {
      const panel = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll("[role=option]")].map((row) =>
        row.getBoundingClientRect(),
      );
      const first = rows[0] as DOMRect;
      const last = rows[rows.length - 1] as DOMRect;
      const style = getComputedStyle(element);
      return {
        padTop: Number.parseFloat(style.paddingTop),
        padBottom: Number.parseFloat(style.paddingBottom),
        top: first.top - panel.top,
        bottom: panel.bottom - last.bottom,
        scrolls: element.scrollHeight > element.clientHeight,
        inside: panel.top >= 0 && panel.bottom <= window.innerHeight,
      };
    });
    expect(Math.abs(gaps.padTop - gaps.padBottom)).toBeLessThanOrEqual(1);
    // Scrolled to the top, the first row sits a padding under the panel's edge (the border adds one).
    if (!gaps.scrolls) expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(2);
    expect(gaps.inside).toBe(true);
  });

  test("has 44px targets", async ({ page }) => {
    await open(page, "model");
    for (const target of [combo(page), page.getByLabel("Provider")]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("offline", () => {
  test.use({ allowNetworkErrors: true });

  test("an unreachable site is said plainly", async ({ page }) => {
    await page.route("**/api/config", (route) => route.abort("connectionrefused"));
    await open(page, "daily");
    await page.locator("#daily-hour").selectOption("9");
    await expect(toastText(page)).toHaveText("The site could not be reached. Not saved yet.");
  });

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
    await expect(
      page.getByText("Only the top models are listed right now. For another model, type its id."),
    ).toBeVisible();
    await expect(combo(page)).toHaveValue("Automatic");
    await page.getByRole("button", { name: "Show all models" }).click();
    await expect(grouped(page, "Top models")).toHaveText(
      NEBIUS_TOP.map((model) => new RegExp(`^${model.label.replaceAll(".", "\\.")}`)),
    );
    await expect(options(page)).toHaveCount(NEBIUS_TOP.length + 1);
    await expect(page.locator("[data-count]")).toHaveText(`${NEBIUS_TOP.length + 1} models`);
    await page.keyboard.press("Escape");
    await pick(page, "flash", /^DeepSeek V4\.1 Flash/);
    await expect(combo(page)).toHaveValue("DeepSeek V4.1 Flash");
    await expect(toastText(page)).toHaveText(SAVED);
    expect(opsOf(sent)).toEqual([
      { op: "writer.set", provider: "nebius", model: "deepseek-ai/DeepSeek-V4.1-Flash" },
    ]);
  });

  test("without the model list a field takes the id of any other model", async ({ page }) => {
    await unavailable(page);
    const sent = await mockConfig(page);
    await open(page, "model");
    await expect(combo(page)).toHaveValue("Automatic");

    const typed = page.getByLabel("Model id");
    await typed.fill("not valid!");
    await expect(typed).toHaveAttribute("aria-invalid", "");
    // A typed id is saved once it is finished, not letter by letter.
    await typed.fill("acme/Fast-1:beta");
    await page.waitForTimeout(1600);
    expect(sent).toHaveLength(0);
    await typed.press("Enter");
    await typed.blur();
    await expect(toastText(page)).toHaveText(SAVED);
    expect(sent[0]?.op).toEqual({
      op: "writer.set",
      provider: "nebius",
      model: "acme/Fast-1:beta",
    });
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

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} scheme`, () => {
    for (const leaf of ["daily", "weekly", "model"] as const) {
      test(`the ${leaf} page has no WCAG 2.2 AA violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, leaf);
        await page.evaluate(() => document.fonts.ready);
        expect(await violations(page)).toEqual([]);
      });
    }

    test("none with the saving toast up", async ({ page }) => {
      await mockConfig(page);
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, "daily");
      await page.locator("#daily-hour").selectOption("9");
      await expect(toastText(page)).toHaveText(SAVED);
      await page.waitForTimeout(400);
      expect(await violations(page)).toEqual([]);
    });

    test("none with the model list open in its groups", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, "model");
      await page.getByRole("button", { name: "Show all models" }).click();
      const list = page.getByRole("listbox", { name: "Models" });
      await expect(list.getByRole("group", { name: "Top models" })).toBeVisible();
      // The list fades in, and a scan mid-fade would read its text at part opacity.
      await list.evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished)),
      );
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });
  });
}

import type { Locator } from "@playwright/test";
import { ACCENT_LIGHT, computedColor, expectColor, INK_LIGHT } from "./colors";
import { expect, hydrated, SILENT_DIGEST, test } from "./fixtures";

/**
 * The contract between the reader page and the player (readerSync.ts). The first half drives the
 * real player on a real built page and checks what it writes onto the chips and the stories. The
 * second half writes the same attributes by hand and checks that the stylesheet reacts, so the
 * page's side of the contract holds on its own. Colors are compared as sRGB, in the light theme.
 */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
});

const face = (chip: Locator) =>
  chip.evaluate((node) => ({
    state: node.getAttribute("data-state"),
    playing: node.getAttribute("data-playing"),
    label: node.querySelector("[data-chip-label]")?.textContent,
    name: node.getAttribute("aria-label"),
  }));

test.describe("what the player writes on a real page", () => {
  test("the briefing chip follows play, pause and resume", async ({ page }) => {
    await hydrated(page);
    const chip = page.locator(".hero [data-play-digest]");
    expect(await face(chip)).toEqual({
      state: "idle",
      playing: "false",
      label: "1 min",
      name: "Play the briefing, 1 min",
    });

    await chip.click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(chip).toHaveAttribute("data-state", "current");
    await expect(chip).toHaveAttribute("data-playing", "true");
    await expect(chip.locator("[data-chip-label]")).toHaveText("Playing");
    await expect(chip).toHaveAccessibleName("Pause the briefing, playing");

    await chip.click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await expect(chip).toHaveAttribute("data-state", "current");
    await expect(chip).toHaveAttribute("data-playing", "false");
    await expect(chip.locator("[data-chip-label]")).toHaveText("1 min left");
    await expect(chip).toHaveAccessibleName("Resume the briefing, 1 min left");

    await chip.click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(chip.locator("[data-chip-label]")).toHaveText("Playing");
  });

  test("a story chip plays from its story and marks what came before as played", async ({
    page,
  }) => {
    await hydrated(page);
    const stories = page.locator(".story");
    const third = stories.nth(2);
    const chip = third.locator("[data-play-item]");
    const headline = (await third.locator("h3 span[id]").textContent()) ?? "";

    await chip.click();
    await expect(chip.locator("[data-chip-label]")).toHaveText("Playing");
    await expect(chip).toHaveAccessibleName(`Pause, playing: ${headline}`);
    await expect(chip).toHaveAttribute("data-playing", "true");

    // A fixture story lasts three seconds, so the rest is checked with the playhead held still.
    await chip.click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await expect(third).toHaveAttribute("data-state", "current");
    await expect(chip).toHaveAttribute("data-state", "current");
    await expect(chip).toHaveAttribute("data-playing", "false");
    await expect(chip.locator("[data-chip-label]")).toHaveText("Paused");
    await expect(chip).toHaveAccessibleName(`Resume, paused: ${headline}`);
    // Only one story is the one being read.
    await expect(page.locator('.story[data-state="current"]')).toHaveCount(1);

    for (const index of [0, 1]) {
      const earlier = stories.nth(index);
      await expect(earlier).toHaveAttribute("data-state", "played");
      await expect(earlier.locator("[data-play-item]")).toHaveAttribute("data-state", "played");
      await expect(earlier.locator("[data-chip-label]")).toHaveText("Played");
      await expect(earlier.locator("[data-play-item]")).toHaveAccessibleName(
        /^Play again, played: /,
      );
    }
    const later = stories.nth(5).locator("[data-play-item]");
    await expect(later).toHaveAttribute("data-state", "idle");
    await expect(later.locator("[data-chip-label]")).toHaveText("0:03");
    await expect(stories.nth(5)).not.toHaveAttribute("data-state", /.*/);
    // The briefing's own chip tells the same story: paused, with the time that is left.
    const briefing = page.locator(".hero [data-play-digest]");
    await expect(briefing).toHaveAttribute("data-state", "current");
    await expect(briefing.locator("[data-chip-label]")).toHaveText("1 min left");
  });

  test("the story being read takes the accent on its headline", async ({ page }) => {
    await hydrated(page);
    const story = page.locator(".story").nth(1);
    const chip = story.locator("[data-play-item]");
    await expectColor(page, await computedColor(story.locator("h3"), "color"), INK_LIGHT);
    await chip.click();
    await expect(chip.locator("[data-chip-label]")).toHaveText("Playing");
    await chip.click();
    await expect(story).toHaveAttribute("data-state", "current");
    // The colour changes over 200ms.
    await page.waitForTimeout(300);
    await expectColor(page, await computedColor(story.locator("h3"), "color"), ACCENT_LIGHT);
    const other = page.locator(".story").nth(4).locator("h3");
    await expectColor(page, await computedColor(other, "color"), INK_LIGHT);
  });

  test("the chips are written again on every page the reader moves to", async ({ page }) => {
    await hydrated(page);
    await page.locator(".story").nth(1).locator("[data-play-item]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");

    // A briefing without audio keeps the state its page rendered, whatever is playing.
    await page.getByRole("link", { name: /Monday 5 October/ }).click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    const silent = page.locator(".hero [data-play-digest]");
    await expect(silent).toHaveAttribute("data-state", "idle");
    await expect(page.locator("[data-play-item]").first()).toBeHidden();
    await expect(page.locator(".story[data-state]")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");

    // Back on the briefing that is playing, the fresh markup takes the live state at once.
    // The wordmark, not the Today tab: on a phone the docked player of this build still sits over
    // the bottom navigation until the rebuilt player docks above it.
    await page.locator('a[href="/"]:visible').first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".hero [data-play-digest]")).toHaveAttribute("data-state", "current");
    await expect(page.locator(".hero [data-play-digest] [data-chip-label]")).toHaveText("Playing");
    await expect(page.locator('.story[data-state="current"]')).toHaveCount(1);
    await expect(page.locator('[data-play-item][data-state="current"]')).toHaveCount(1);
  });

  test("offline, with nothing loaded, the briefing chip is disabled and comes back", async ({
    page,
    context,
  }) => {
    await page.waitForLoadState("networkidle");
    await hydrated(page);
    const chip = page.locator(".hero [data-play-digest]");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(chip).toHaveAttribute("data-state", "unavailable");
    await expect(chip).toHaveAttribute("aria-disabled", "true");
    await expect(chip.locator("[data-chip-label]")).toHaveText("1 min");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(chip).toHaveAttribute("data-state", "idle");
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("how the page reacts to those attributes", () => {
  const display = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).display);

  // The player writes the chips once as it hydrates. Wait for that, so it cannot undo what a test
  // writes by hand.
  test.beforeEach(async ({ page }) => {
    await hydrated(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  });

  test("a current story's headline takes the accent and the others keep full ink", async ({
    page,
  }) => {
    const story = page.locator(".story").nth(1);
    await story.evaluate((element) => element.setAttribute("data-state", "current"));
    await page.waitForTimeout(250);
    await expectColor(page, await computedColor(story.locator("h3"), "color"), ACCENT_LIGHT);
    const other = page.locator(".story").nth(2);
    await expectColor(page, await computedColor(other.locator("h3"), "color"), INK_LIGHT);
    // A summary never steps back: every story stays readable while one is playing.
    await expectColor(
      page,
      await computedColor(other.locator(".story-summary"), "color"),
      INK_LIGHT,
    );
    await expectColor(
      page,
      await computedColor(story.locator(".story-summary"), "color"),
      INK_LIGHT,
    );
  });

  test("an idle chip shows the play glyph in a ring", async ({ page }) => {
    const chip = page.locator("[data-play-item]").nth(1);
    expect(await display(chip.locator(".chip-bars"))).toBe("none");
    expect(await display(chip.locator(".chip-check"))).toBe("none");
    expect(await display(chip.locator(".spinner"))).toBe("none");
    expect(
      await chip.locator(".swap-paused").evaluate((node) => getComputedStyle(node).opacity),
    ).toBe("1");
    expect(
      await chip.locator(".swap-playing").evaluate((node) => getComputedStyle(node).opacity),
    ).toBe("0");
  });

  test("a current chip is filled, and shows bars while it plays", async ({ page }) => {
    const chip = page.locator("[data-play-item]").nth(1);
    const idle = await computedColor(chip, "backgroundColor");
    await chip.evaluate((node) => node.setAttribute("data-state", "current"));
    await page.waitForTimeout(250);
    expect(await computedColor(chip, "backgroundColor")).not.toBe(idle);
    // Paused on this story: still the play glyph.
    expect(await display(chip.locator(".chip-bars"))).toBe("none");
    await chip.evaluate((node) => node.setAttribute("data-playing", "true"));
    expect(await display(chip.locator(".chip-bars"))).toBe("flex");
    expect(await display(chip.locator(".swap"))).toBe("none");
  });

  test("a played chip shows a check, and a preparing one a spinner", async ({ page }) => {
    const chip = page.locator("[data-play-item]").nth(1);
    await chip.evaluate((node) => node.setAttribute("data-state", "played"));
    expect(await display(chip.locator(".chip-check"))).toBe("block");
    expect(await display(chip.locator(".swap"))).toBe("none");
    await chip.evaluate((node) => node.setAttribute("data-state", "preparing"));
    expect(await display(chip.locator(".spinner"))).toBe("block");
    expect(await display(chip.locator(".chip-check"))).toBe("none");
  });

  test("room is reserved for the docked player once it shows", async ({ page }) => {
    const before = await page
      .locator("main")
      .evaluate((node) => getComputedStyle(node).paddingBottom);
    await page.evaluate(() => {
      document.documentElement.dataset.mini = "visible";
    });
    const after = await page
      .locator("main")
      .evaluate((node) => getComputedStyle(node).paddingBottom);
    // At least a bar's height, until the player has measured itself and published its own.
    expect(Number.parseFloat(after) - Number.parseFloat(before)).toBeGreaterThanOrEqual(48);
  });

  test("while offline the story chips step out of the way and the briefing chip stays", async ({
    page,
  }) => {
    await page.evaluate(() => {
      document.documentElement.dataset.offline = "";
    });
    await expect(page.locator("[data-play-item]").first()).toBeHidden();
    await expect(page.locator(".story .source-link").first()).toBeVisible();
    await expect(page.locator(".hero [data-play-digest]")).toBeVisible();
  });

  test("an aria-disabled control swallows clicks before any other handler sees them", async ({
    page,
  }) => {
    await page.goto(SILENT_DIGEST);
    await page.evaluate(() => {
      document.querySelector(".hero [data-play-digest]")?.setAttribute("aria-disabled", "true");
      (window as unknown as { __clicks: number }).__clicks = 0;
      document.addEventListener("click", () => {
        (window as unknown as { __clicks: number }).__clicks += 1;
      });
    });
    // Playwright will not click a disabled control, which is the point; force it as a finger would.
    await page.locator(".hero [data-play-digest]").click({ force: true });
    expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(0);
  });
});

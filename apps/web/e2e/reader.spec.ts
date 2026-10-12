import type { Page } from "@playwright/test";
import type { PlayerDigestData } from "../src/types/contracts";
import { toRgba } from "./colors";
import { AUDIO_DIGEST, expect, hydrated, SILENT_DIGEST, test } from "./fixtures";

const FIRST_HEADLINE =
  "Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity";

test.describe("the briefing header", () => {
  test("renders the date, the play chip with the story count, and the More menu", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    // The fixture recording is 36 seconds long, which a chip rounds up to a minute. The length is
    // the chip's label alone; under the date stands how many stories there are.
    await expect(page.locator(".hero-text .hero-facts > span")).toHaveText(["12 stories"]);
    const chip = page.locator(".hero [data-play-digest]");
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-play-digest", "2026-10-07");
    await expect(chip.locator("[data-chip-label]")).toHaveText("1 min");
    await expect(chip).toHaveAccessibleName("Play the briefing, 1 min");
    await expect(chip).toHaveAttribute("data-state", "idle");
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
    await expect(page.locator(".hero-hint")).toHaveCount(0);
  });

  test("a briefing without audio keeps a working chip and says nothing about it", async ({
    page,
  }) => {
    await page.goto(SILENT_DIGEST);
    const chip = page.locator(".hero [data-play-digest]");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-state", "idle");
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    // The estimate written with the text stands in until there is a recording to measure.
    await expect(chip.locator("[data-chip-label]")).toHaveText("3 min");
    // Nothing is said under the chip: pressing it is self-explanatory.
    await expect(page.locator(".hero-hint")).toHaveCount(0);
    // The player leaves a briefing without audio exactly as the page rendered it.
    await hydrated(page);
    await expect(chip).toHaveAttribute("data-state", "idle");
  });

  test("asks for the intro and the first story at idle, and a press joins that work", async ({
    page,
  }) => {
    const asked: string[] = [];
    await page.route("**/api/narrate?digest=*", async (route) => {
      const ids: string[] = await page.evaluate(() => {
        const data = JSON.parse(
          document.getElementById("dispatch-digest-data")?.textContent ?? "{}",
        );
        return (data.items as { id: string }[]).map((item) => item.id);
      });
      await route.fulfill({
        json: {
          status: 200,
          audio: null,
          timeline: null,
          ms_per_character: 62,
          segments: ["intro", ...ids].map((key) => ({
            key,
            item_id: key === "intro" ? null : key,
            characters: 300,
            audio: null,
          })),
        },
      });
    });
    await page.route("**/api/narrate", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const { segment } = route.request().postDataJSON() as { segment: string };
      asked.push(segment);
      // Slow enough that the press below lands while the first request is still on its way.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return route.fulfill({
        json: {
          status: 200,
          segment: {
            key: segment,
            item_id: segment === "intro" ? null : segment,
            characters: 300,
            audio: { url: "/fixtures/audio.wav", duration_ms: 18_600, confirmed: true },
          },
        },
      });
    });
    await page.goto(SILENT_DIGEST);
    await hydrated(page);
    await expect.poll(() => asked.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect.poll(() => asked.length).toBeGreaterThanOrEqual(2);
    // The intro and the first story were each asked for once, by the prewarm, not again by the press.
    expect(asked.slice(0, 2)[0]).toBe("intro");
    expect(asked.filter((key) => key === "intro")).toHaveLength(1);
    expect(new Set(asked).size).toBe(asked.length);
  });

  test("pressing play on a briefing without audio narrates it story by story", async ({ page }) => {
    await page.goto(SILENT_DIGEST);
    await hydrated(page);
    const ids = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
      return (data.items as { id: string }[]).map((item) => item.id);
    });
    // The server knows where each story's file would be. Here every one already exists.
    await page.route("**/api/narrate?digest=*", (route) =>
      route.fulfill({
        json: {
          status: 200,
          audio: null,
          timeline: null,
          ms_per_character: 62,
          segments: ["intro", ...ids].map((key) => ({
            key,
            item_id: key === "intro" ? null : key,
            characters: 300,
            audio: { url: "/fixtures/audio.wav", duration_ms: 18_600, confirmed: false },
          })),
        },
      }),
    );
    // Asked about the first one, the server answers that it exists.
    await page.route("**/api/narrate", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const { segment } = route.request().postDataJSON() as { segment: string };
      return route.fulfill({
        json: {
          status: 200,
          segment: {
            key: segment,
            item_id: segment === "intro" ? null : segment,
            characters: 300,
            audio: { url: "/fixtures/audio.wav", duration_ms: 18_600, confirmed: true },
          },
        },
      });
    });
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    const chip = page.locator(".hero [data-play-digest]");
    await expect(chip).toHaveAttribute("data-state", "current");
    await expect(chip.locator("[data-chip-label]")).toHaveText(/min left$/);
    // The story chips the page rendered hidden now have something to play.
    await expect(page.locator("[data-play-item]").first()).toBeVisible();
    await expect(page.locator(".hero-hint")).toBeHidden();
  });
});

test.describe("sharing", () => {
  test("hands the dated address to the share sheet where there is one", async ({ page }) => {
    await page.addInitScript(() => {
      const shared: ShareData[] = [];
      (window as unknown as { __shared: ShareData[] }).__shared = shared;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (data: ShareData) => {
          shared.push(data);
          return Promise.resolve();
        },
      });
    });
    await page.goto("/");
    const more = page.getByRole("button", { name: "More actions" });
    await expect
      .poll(async () => {
        await more.click();
        await page.getByRole("menuitem", { name: "Share" }).click();
        return page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared[0]);
      })
      .toBeTruthy();
    const shared = await page.evaluate(
      () => (window as unknown as { __shared: ShareData[] }).__shared[0],
    );
    // Today's page shares the dated address, so the link still opens this briefing next week.
    expect(shared?.url).toMatch(/\/d\/2026-10-07$/);
    expect(shared?.title).toBe("Wednesday 7 October, Singularity");
    await expect(more).not.toHaveAttribute("data-copied", /.*/);
  });

  test("copies the address and says so where there is no share sheet", async ({ page }) => {
    await page.addInitScript(() => {
      const copied: string[] = [];
      (window as unknown as { __copied: string[] }).__copied = copied;
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            copied.push(text);
            return Promise.resolve();
          },
        },
      });
    });
    await page.goto(SILENT_DIGEST);
    // By its hook: its name changes while the copy is confirmed.
    const more = page.locator("[data-hero-more]");
    // An older briefing has nothing to offer but Share, so its button shares at once.
    await expect(more).toHaveAccessibleName("Share this briefing");
    await expect(page.locator(".hero-menu-list")).toHaveCount(0);
    await expect(async () => {
      await more.click();
      await expect(more).toHaveAttribute("data-copied", "", { timeout: 500 });
    }).toPass();
    // The button says it was copied, and it is spoken.
    await expect(more).toHaveAccessibleName("Link copied");
    await expect(page.locator("[data-share-status]")).toHaveText("Link copied");
    await expect(more.locator(".more-done")).toBeVisible();
    await expect(more.locator(".more-icon")).toBeHidden();
    const copied = await page.evaluate(
      () => (window as unknown as { __copied: string[] }).__copied,
    );
    expect(copied[0]).toMatch(/\/d\/2026-10-05$/);
    // Two seconds later the button is itself again.
    await expect(more).toHaveAccessibleName("Share this briefing", { timeout: 4_000 });
    await expect(more).not.toHaveAttribute("data-copied", /.*/);
    await expect(page.locator("[data-share-status]")).toHaveText("");
  });

  test("the latest briefing offers New briefing, which says since when it covers", async ({
    page,
  }) => {
    for (const path of ["/", "/d/2026-10-07"]) {
      await page.goto(path);
      await hydrated(page);
      await page.getByRole("button", { name: "More actions" }).click();
      const items = page.locator(".hero-menu-list [role=menuitem]");
      await expect(items).toHaveText(["Share", "New briefing"]);
    }
    await openNewBriefing(page);
  });
});

async function openNewBriefing(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("menuitem", { name: "New briefing" }).click();
  const dialog = page.getByRole("dialog", { name: "New briefing" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".sheet-lede")).toHaveText(
    /^Covers everything since [^.]+\. Takes a few minutes\.$/,
  );
}

test.describe("sections and stories", () => {
  test("groups stories into sections in the fixed order", async ({ page }) => {
    await page.goto("/");
    const sections = page.locator("[data-chapter]");
    await expect(sections).toHaveCount(6);
    await expect(sections.locator("h2")).toHaveText([
      "Top picks",
      "Design engineering",
      "AI products",
      "Research",
      "Launches",
      "Watch and listen",
    ]);
    await expect(page.locator(".story")).toHaveCount(12);
    // A section header is its title alone: no listening time beside it.
    await expect(page.locator(".head-fact")).toHaveCount(0);
    await expect(sections.first().locator("h2")).toHaveText("Top picks");
  });

  test("keeps headings in order: the date, then sections, then stories", async ({ page }) => {
    await page.goto("/");
    const levels = await page
      .locator("main :is(h1, h2, h3)")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))));
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let index = 1; index < levels.length; index += 1) {
      // A heading never skips a level on the way down.
      expect((levels[index] ?? 0) - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
    }
    await expect(page.locator(".story h3")).toHaveCount(12);
  });

  test("gives every story the attributes the player reads", async ({ page }) => {
    await page.goto("/");
    const stories = page.locator(".story");
    for (let index = 0; index < 12; index += 1) {
      const story = stories.nth(index);
      await expect(story).toHaveAttribute("data-index", String(index));
      await expect(story).toHaveAttribute("data-item-id", /^[0-9a-f]{12}$/);
      await expect(story.locator("[data-play-item]")).toHaveAttribute(
        "data-play-item",
        String(index),
      );
    }
    await expect(page.locator("[data-chapter]").first()).toHaveAttribute("data-chapter", "top");
    await expect(page.locator(".story[data-state]")).toHaveCount(0);
  });

  test("labels each story chip with its length and names its action", async ({ page }) => {
    await page.goto("/");
    const chip = page.locator(".story").first().locator("[data-play-item]");
    await expect(chip).toBeVisible();
    await expect(chip.locator("[data-chip-label]")).toHaveText("0:03");
    await expect(chip).toHaveAccessibleName(`Play from here, 0:03: ${FIRST_HEADLINE}`);
    await expect(chip).toHaveAttribute("data-state", "idle");
    expect(await chip.evaluate((node) => node.tagName)).toBe("BUTTON");
  });

  test("hydration leaves every idle chip as the page rendered it", async ({
    page,
    browser,
    baseURL,
  }) => {
    const read = (target: typeof page) =>
      target.locator(".chip").evaluateAll((nodes) =>
        nodes.map((node) => ({
          label: node.querySelector("[data-chip-label]")?.textContent,
          name: node.getAttribute("aria-label"),
          state: node.getAttribute("data-state"),
          playing: node.getAttribute("data-playing"),
        })),
      );
    // The page as the server wrote it: the same build, with script turned off.
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const plain = await context.newPage();
    await plain.goto("/");
    const rendered = await read(plain);
    await context.close();
    // The briefing's chip and one per story.
    expect(rendered).toHaveLength(13);

    await page.goto("/");
    await hydrated(page);
    // One frame for the player's first write.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    expect(await read(page)).toEqual(rendered);
  });

  test("the headline is the story's link, in a new tab, and the publisher its attribution", async ({
    page,
  }) => {
    await page.goto("/");
    const first = page.locator(".story").first();
    // One link a keyboard or a screen reader meets: the headline. Its name starts with what it
    // shows (WCAG 2.5.3); the new tab is said, not shown.
    const link = first.getByRole("link");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAccessibleName(`${FIRST_HEADLINE} (opens in a new tab)`);
    await expect(first.locator("h3 a")).toHaveAttribute("href", /^https:\/\/example\.com\//);
    await expect(first.locator("h3 a")).toHaveAttribute("target", "_blank");
    await expect(first.locator("h3 a")).toHaveAttribute("rel", "noopener noreferrer");
    // The story is named by the headline's words alone.
    await expect(first).toHaveAccessibleName(FIRST_HEADLINE);
    // The publisher goes to the same page: a pointer target, out of the tab order and the tree.
    const source = first.locator(".source-link");
    await expect(source.locator(":scope > span").first()).toHaveText("Springlet Blog");
    await expect(source).toHaveAttribute(
      "href",
      (await first.locator("h3 a").getAttribute("href")) ?? "",
    );
    await expect(source).toHaveAttribute("tabindex", "-1");
    await expect(source).toHaveAttribute("aria-hidden", "true");
  });

  test("a briefing narrated on Play has its Play unavailable offline, and back when online", async ({
    page,
    context,
  }) => {
    await page.goto(SILENT_DIGEST);
    // The page's idle request for its narration is made before the network goes away.
    await page.waitForLoadState("networkidle");
    await hydrated(page);
    const chip = page.locator(".hero [data-play-digest]");
    const before = await chip.getAttribute("data-state");
    expect(before).not.toBe("unavailable");
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(chip).toHaveAttribute("aria-disabled", "true");
    await expect(chip).toHaveAttribute("data-state", "unavailable");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    await expect(chip).toHaveAttribute("data-state", before ?? "");
  });

  test("Today's briefing chip says what the Library's card says: time left, or Played", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("dispatch:resume:2026-10-07", "20"));
    await page.reload();
    await hydrated(page);
    const chip = page.locator(".hero [data-play-digest]");
    await expect(chip.locator("[data-chip-label]")).toHaveText("1 min left");
    // Heard to the end on another visit: the position is forgotten and the briefing is Played. Set
    // away from the page, which saves its own position as it is left.
    await page.goto("/library");
    await page.evaluate(() => {
      localStorage.removeItem("dispatch:resume:2026-10-07");
      localStorage.setItem("dispatch:played:2026-10-07", "1");
    });
    await page.goto("/");
    await hydrated(page);
    await expect(chip.locator("[data-chip-label]")).toHaveText("Played");
    await expect(chip).toHaveAccessibleName("Play the briefing again, played");
    await expect(chip).toHaveAttribute("data-state", "played");
  });

  test("a story played from here does not mark the stories it stepped over as played", async ({
    page,
  }) => {
    for (const from of [1, 2]) {
      await page.goto("/");
      await hydrated(page);
      const chip = (index: number) => page.locator(".story").nth(index).locator("[data-play-item]");
      await chip(from).click();
      await expect(chip(from)).not.toHaveAttribute("data-state", "idle");
      // Nothing was heard of the ones before it: they stay as they were, with their lengths.
      for (let index = 0; index < from; index += 1) {
        await expect(chip(index)).toHaveAttribute("data-state", "idle");
        await expect(chip(index).locator("[data-chip-label]")).toHaveText(/^\d+:\d\d$/);
      }
    }
  });

  test("the page does not pull a reader who scrolled elsewhere back to the voice", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await hydrated(page);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    // A scroll that is not a wheel or a touch, far from the story being read.
    await page.evaluate(() => {
      document.querySelector("#c-watch")?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    const away = await page.evaluate(() => scrollY);
    expect(away).toBeGreaterThan(1000);
    // Playing goes on through three stories (three seconds each in the fixture).
    await page.waitForTimeout(8_000);
    expect(Math.abs((await page.evaluate(() => scrollY)) - away)).toBeLessThan(40);
  });

  test("keeps story chips in the page, hidden, while a briefing has no audio", async ({ page }) => {
    await page.goto(SILENT_DIGEST);
    await expect(page.locator(".story")).toHaveCount(8);
    const chips = page.locator("[data-play-item]");
    await expect(chips).toHaveCount(8);
    for (const chip of await chips.all()) {
      await expect(chip).toHaveAttribute("hidden", "");
      await expect(chip).toBeHidden();
    }
    // The source link stands alone at the start of the row.
    await expect(page.locator(".story .source-link").first()).toBeVisible();
    // Sections show no listening length, and the text is complete without audio.
    await expect(page.locator(".head-fact")).toHaveCount(0);
    await hydrated(page);
    await expect(chips.first()).toHaveAttribute("hidden", "");
  });

  test("sets the digest id on the page and in the JSON the player reads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toHaveAttribute("data-digest-id", "2026-10-07");
    await expect(page.locator("html")).toHaveAttribute("data-digest-id", "2026-10-07");
    const data = (await page.evaluate(() =>
      JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "null"),
    )) as PlayerDigestData;
    expect(data.id).toBe("2026-10-07");
    expect(data.title).toBe("Wednesday 7 October");
    expect(data.items).toHaveLength(12);
    expect(data.items[0]?.start_ms).toBe(0);
    expect(data.audio).toEqual({ url: "/fixtures/audio.wav", duration_ms: 36_000 });
    expect(data.timeline).toBe("marks");
    expect(data.sections.map((section) => section.slug)).toEqual([
      "top",
      "ui-craft",
      "ai",
      "research",
      "launches",
      "watch",
    ]);
    expect(data.cover.src512).toBe("/covers/2026-10-07-512.webp");
    // Pages show the WebP; the PNG beside it is for the lock screen's media controls.
    const webp = await page.request.get(data.cover.src512);
    expect(webp.headers()["content-type"]).toBe("image/webp");
    const png = await page.request.get("/covers/2026-10-07-512.png");
    expect(png.headers()["content-type"]).toBe("image/png");
    expect(data.cover.key).toMatch(/^#[0-9a-f]{6}$/);
    expect(data.prev_id).toBe("2026-10-05");
    expect(data.next_id).toBeNull();
    // The item ids in the data match the ids in the markup, in the same order.
    const ids = await page
      .locator(".story")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id")));
    expect(data.items.map((item) => item.id)).toEqual(ids);
  });

  test("shows the same briefing at /d/<id> as at the home page", async ({ page }) => {
    await page.goto(AUDIO_DIGEST);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    await expect(page.locator(".story")).toHaveCount(12);
  });

  test("is readable with JavaScript turned off", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    await expect(page.locator(".story")).toHaveCount(12);
    await expect(page.locator(".story .source-link").first()).toBeVisible();
    // The tabs are plain links to the sections, so they work without script.
    await expect(page.locator(".tabs .tab").nth(3)).toHaveAttribute("href", "#c-research");
    await expect(page.locator("#c-research")).toHaveText("Research");
    await context.close();
  });
});

test.describe("section tabs", () => {
  // The app bar slides away on a scroll down unless motion is reduced, which moves the strip up with
  // it. These tests measure the strip against a bar that stays put.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("link to each section and start on the first", async ({ page }) => {
    await page.goto("/");
    const tabs = page.locator('nav[aria-label="Sections"] .tab');
    await expect(tabs).toHaveText([
      "Top picks",
      "Design engineering",
      "AI products",
      "Research",
      "Launches",
      "Watch and listen",
    ]);
    await expect(tabs.first()).toHaveAttribute("href", "#c-top");
    await expect(tabs.first()).toHaveAttribute("aria-current", "true");
    await expect(page.locator('.tab[aria-current="true"]')).toHaveCount(1);
  });

  test("pressing tabs adds no history entries, so Back leaves the page", async ({ page }) => {
    await page.goto("/library");
    await page.goto("/");
    const before = await page.evaluate(() => history.length);
    await page.locator(".tab", { hasText: "Research" }).click();
    await expect(page).toHaveURL(/#c-research$/);
    await page.locator(".tab").first().click();
    expect(await page.evaluate(() => history.length)).toBe(before);
    await page.goBack();
    await expect(page).toHaveURL(/\/library/);
  });

  test("a tab reached with the keyboard is brought fully into the strip", async ({ page }) => {
    await page.goto("/");
    await hydrated(page);
    const last = page.locator(".tab").last();
    await last.focus();
    await expect
      .poll(async () => {
        const strip = await page.locator(".tabs").boundingBox();
        const tab = await last.boundingBox();
        return (
          !!strip &&
          !!tab &&
          tab.x >= strip.x - 0.5 &&
          tab.x + tab.width <= strip.x + strip.width + 0.5
        );
      })
      .toBe(true);
  });

  test("an episode page says episode, not briefing, to assistive tech", async ({ page }) => {
    await page.goto("/e/ep-20261007-1930");
    await expect(page.locator(".skip-link")).toHaveText("Skip to the episode");
    await expect(page.locator(".hero [data-play-digest]")).toHaveAccessibleName(
      /^Play the episode, /,
    );
  });

  test("mark the section in view and bring its tab into the strip", async ({ page }) => {
    await page.goto("/");
    const current = page.locator('.tab[aria-current="true"]');
    await page.evaluate(() => {
      document.querySelector("#c-launches")?.scrollIntoView({ block: "start" });
    });
    await expect(current).toHaveText("Launches");
    await expect(current).toHaveCount(1);
    await expect(current).toBeInViewport({ ratio: 1 });
    expect(await page.locator(".tabs").evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    // Scrolling the strip did not move the page sideways.
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(current).toHaveText("Top picks");
  });

  test("an instant jump to the top marks the first tab, though its section starts below mid-screen", async ({
    page,
  }) => {
    // On a short phone the first section starts under the middle of the screen, so at the top no
    // section crosses the reading band.
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/");
    const current = page.locator('.tab[aria-current="true"]');
    await page.evaluate(() => {
      document.querySelector("#c-research")?.scrollIntoView({ block: "start" });
    });
    await expect(current).toHaveText("Research");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(current).toHaveText("Top picks");
  });

  test("a tapped tab jumps to its section, clear of the strip, and takes the mark", async ({
    page,
  }) => {
    await page.goto("/");
    const tab = page.locator(".tab", { hasText: "Research" });
    await tab.click();
    await expect(page).toHaveURL(/#c-research$/);
    await expect(tab).toHaveAttribute("aria-current", "true");
    await expect(page.locator('.tab[aria-current="true"]')).toHaveCount(1);
    // The heading's words land clear of the strip, and the section's rule above them tucks under
    // it, so the strip's own line is the only one.
    const landing = await page.locator("#c-research").evaluate((heading) => {
      const words = document.createRange();
      words.selectNodeContents(heading);
      return {
        words: words.getBoundingClientRect().top,
        rule: heading.closest(".chapter")?.getBoundingClientRect().top ?? 0,
      };
    });
    const strip = await page.locator(".tabs").boundingBox();
    const stripEnd = (strip?.y ?? 0) + (strip?.height ?? 0);
    expect(landing.words).toBeGreaterThanOrEqual(stripEnd);
    expect(landing.words).toBeLessThan(260);
    expect(landing.rule).toBeLessThan(stripEnd);
  });

  test("a control reached by Shift+Tab is never left under the strip (WCAG 2.4.11)", async ({
    page,
  }) => {
    await page.goto("/");
    // Far down the briefing, then back up one control at a time: each one scrolls clear of the
    // strip while it sticks.
    for (let step = 0; step < 26; step += 1) await page.keyboard.press("Tab");
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Shift+Tab");
      const covered = await page.evaluate(() => {
        const control = document.activeElement?.getBoundingClientRect();
        const strip = document.querySelector<HTMLElement>(".tabs");
        if (!control || !strip) return 0;
        const box = strip.getBoundingClientRect();
        const stuck = box.top <= Number.parseFloat(getComputedStyle(strip).top) + 0.5;
        return stuck ? Math.max(0, box.bottom - control.top) : 0;
      });
      expect(covered).toBe(0);
    }
  });

  test("the last tab keeps the mark even where its section cannot reach the top", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 1400 });
    await page.goto("/");
    const tab = page.locator(".tab", { hasText: "Watch and listen" });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-current", "true");
    // Still held a moment later, after the observer has had its say.
    await page.waitForTimeout(300);
    await expect(tab).toHaveAttribute("aria-current", "true");
  });

  test("at the end of the page the last tab takes the mark, though its section cannot reach the top", async ({
    page,
  }) => {
    // The weekly is the oldest briefing: nothing follows its last section, so the page ends while
    // that section is still well below the strip.
    await page.goto("/d/2026-10-04-weekly");
    const current = page.locator('.tab[aria-current="true"]');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(current).toHaveText("Watch and listen");
    await page.evaluate(() => {
      document.querySelector("#c-research")?.scrollIntoView({ block: "start" });
    });
    await expect(current).toHaveText("Research");
  });

  test("follow the page again after a client-side navigation", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("link", { name: /Wednesday 7 October/ }).click();
    await expect(page).toHaveURL(/\/d\/2026-10-07$/);
    await page.evaluate(() => {
      document.querySelector("#c-research")?.scrollIntoView({ block: "start" });
    });
    await expect(page.locator('.tab[aria-current="true"]')).toHaveText("Research");
  });
});

test.describe("the section tabs with the app bar hidden", () => {
  test("the mark follows the line under the strip, wherever the bar is", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await hydrated(page);
    const root = page.locator("html");
    const current = page.locator('.tab[aria-current="true"]');
    // Well above Research, then down towards it: a scroll down sends the bar away.
    await page.evaluate(() => {
      const top = document.querySelector("#c-research")?.getBoundingClientRect().top ?? 0;
      window.scrollTo({ top: scrollY + top - 400, behavior: "instant" });
    });
    await page.mouse.wheel(0, 200);
    await expect(root).toHaveAttribute("data-bar-hidden", "");
    await expect
      .poll(async () => (await page.locator(".tabs").boundingBox())?.y ?? 99)
      .toBeLessThan(2);
    // Research's heading well under the strip: the section above still crosses the reading line.
    const placeUnderStrip = (gap: number) =>
      page.evaluate((room) => {
        const strip = document.querySelector(".tabs")?.getBoundingClientRect().bottom ?? 0;
        const top = document.querySelector("#c-research")?.getBoundingClientRect().top ?? 0;
        window.scrollBy({ top: top - strip - room, behavior: "instant" });
      }, gap);
    await placeUnderStrip(72);
    await expect(root).toHaveAttribute("data-bar-hidden", "");
    await expect(current).toHaveText("AI products");
    // Past the line, Research takes the mark: the line is measured from where the strip is now.
    await placeUnderStrip(4);
    await expect(current).toHaveText("Research");
  });
});

test.describe("a tapped tab's mark", () => {
  test("goes back to following the page when anything but a wheel scrolls it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await hydrated(page);
    const current = page.locator('.tab[aria-current="true"]');
    await page.locator(".tab", { hasText: "Research" }).click();
    await expect(current).toHaveText("Research");
    await page.waitForTimeout(300);
    // A scrollbar drag, a find, the player following its story: a scroll with no wheel or key.
    await page.evaluate(() => {
      document
        .querySelector("#c-launches")
        ?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    await expect(current).toHaveText("Launches");
  });

  test("stays on the tapped tab while the page only settles", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await hydrated(page);
    const tab = page.locator(".tab", { hasText: "Watch and listen" });
    await tab.click();
    await page.waitForTimeout(600);
    await expect(tab).toHaveAttribute("aria-current", "true");
  });
});

test.describe("a headline under the pointer", () => {
  test("is underlined whole, a hyphenated word included", { tag: "@desktop" }, async ({ page }) => {
    await page.goto("/");
    await hydrated(page);
    const link = page.locator(".story-link", { has: page.locator(".no-break") }).first();
    await link.hover();
    const lines = await link.evaluate((node) =>
      [...node.querySelectorAll(".no-break")].map((word) => {
        const css = getComputedStyle(word);
        return css.textDecorationLine;
      }),
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toBe("underline");
  });
});

test.describe("a tab's jump with the app bar", () => {
  /** Where the heading's words stand under the strip's bottom edge, in pixels. */
  const wordsUnderStrip = (page: Page, id: string) =>
    page.locator(id).evaluate((heading) => {
      const words = document.createRange();
      words.selectNodeContents(heading);
      const strip = document.querySelector(".tabs")?.getBoundingClientRect().bottom ?? 0;
      return words.getBoundingClientRect().top - strip;
    });
  const stripRests = (page: Page) =>
    expect.poll(async () => (await page.locator(".tabs").boundingBox())?.y ?? 99).toBeLessThan(2);

  test("down: the bar goes first, so the heading lands by the strip where it ends", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await hydrated(page);
      const root = page.locator("html");
      await expect(root).not.toHaveAttribute("data-bar-hidden", "");
      await page.locator(".tab", { hasText: "Research" }).click();
      await expect(root).toHaveAttribute("data-bar-hidden", "");
      await stripRests(page);
      // The heading lands by the strip, clear of it.
      await expect.poll(() => wordsUnderStrip(page, "#c-research")).toBeGreaterThanOrEqual(0);
      expect(await wordsUnderStrip(page, "#c-research")).toBeLessThan(80);
    }
  });

  test("up: the bar stays away, and the heading stays clear of the strip", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await hydrated(page);
    const root = page.locator("html");
    await page.evaluate(() => {
      const top = document.querySelector("#c-launches")?.getBoundingClientRect().top ?? 0;
      window.scrollTo({ top: scrollY + top - 400, behavior: "instant" });
    });
    await page.mouse.wheel(0, 200);
    await expect(root).toHaveAttribute("data-bar-hidden", "");
    await stripRests(page);
    // A click from the page itself: Playwright's own would first scroll the stuck strip to where it
    // sits in the flow, moving the page it is about to measure.
    await page
      .locator(".tab", { hasText: "Research" })
      .evaluate((tab) => (tab as HTMLElement).click());
    await expect(page.locator('.tab[aria-current="true"]')).toHaveText("Research");
    await expect(root).toHaveAttribute("data-bar-hidden", "");
    await stripRests(page);
    await expect.poll(() => wordsUnderStrip(page, "#c-research")).toBeGreaterThanOrEqual(0);
    expect(await wordsUnderStrip(page, "#c-research")).toBeLessThan(80);
  });
});

test.describe("earlier briefings", () => {
  test("lists the earlier briefings and a way to all of them", async ({ page }) => {
    await page.goto("/");
    // A shelf of covers, not a list: the same card the Library uses.
    await expect(
      page.getByRole("heading", { level: 2, name: "Earlier briefings", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".earlier .shelf > .card")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/library");
    await expect(page.locator(".earlier .card-title")).toHaveText([
      "Monday 5 October",
      "Sunday 4 October",
    ]);
  });

  test("marks the weekly deep dive in the list of earlier briefings", async ({ page }) => {
    await page.goto(SILENT_DIGEST);
    const weekly = page.locator(".earlier .card", { hasText: "Weekly" });
    await expect(weekly).toHaveCount(1);
    await expect(weekly.locator(".card-title")).toHaveText("Sunday 4 October");
    await expect(weekly.locator(".card-facts")).toHaveText("Weekly · 14 stories · 8 min");
    await expect(page.locator(".earlier .cover[data-weekly]")).toHaveCount(1);
  });

  test("is left out under the oldest briefing, which has nothing before it", async ({ page }) => {
    await page.goto("/d/2026-10-04-weekly");
    await expect(page.locator(".story")).toHaveCount(14);
    await expect(page.locator(".earlier")).toHaveCount(0);
  });
});

test.describe("the page head", () => {
  test("carries the tags an installed iPhone app needs", async ({ page }) => {
    await page.goto("/");
    const head = page.locator("head");
    await expect(head.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
    await expect(head.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/apple-touch-icon.png",
    );
  });

  test("uses an opaque background on the sticky app bar", async ({ page }) => {
    await page.goto("/");
    const bar = await page.locator(".app-bar").evaluate((node) => {
      const style = getComputedStyle(node);
      return { position: style.position, background: style.backgroundColor, top: style.top };
    });
    expect(bar.position).toBe("sticky");
    expect(bar.top).toBe("0px");
    // Opaque means an alpha of one, which Safari 26 needs to sample the status-bar tint.
    expect((await toRgba(page, bar.background)).alpha).toBe(255);
    expect(bar.background).not.toContain("/");
  });
});

test.describe("the page's chrome", () => {
  test("the floating Play follows the hero's Play in the page, so it is never styled before it", async ({
    page,
  }) => {
    for (const path of ["/", "/d/2026-10-05", "/e/ep-20261007-1930"]) {
      await page.goto(path);
      const after = await page.evaluate(() => {
        const hero = document.querySelector(".hero-actions");
        const fab = document.querySelector(".play-fab");
        return Boolean(
          hero && fab && hero.compareDocumentPosition(fab) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      });
      expect(after, path).toBe(true);
      await expect(page.locator(".play-fab"), path).toBeHidden();
    }
  });

  test("the latest briefing at its dated address is Today: no Back in the app bar", async ({
    page,
  }) => {
    await page.goto("/d/2026-10-07");
    await expect(page.locator(".app-bar-back")).toHaveCount(0);
    await expect(page.locator('.app-nav [aria-current="page"]')).toHaveText(/Today/);
    // An older briefing is one level down from the Library, and leads back to it.
    await page.goto(SILENT_DIGEST);
    await expect(page.locator(".app-bar-back")).toHaveAttribute("href", "/library");
  });
});

test.describe("the app bar's Back", () => {
  // The app bar shows below 64rem; the desktop project narrows its window to reach it with a mouse.
  async function narrow(page: Page): Promise<void> {
    const size = page.viewportSize();
    if (size && size.width >= 1024) await page.setViewportSize({ width: 900, height: size.height });
  }

  test("Back returns to the page you came from: Today, then an earlier briefing", async ({
    page,
  }) => {
    await narrow(page);
    await page.goto("/");
    await hydrated(page);
    await page.locator(`a[href="${SILENT_DIGEST}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${SILENT_DIGEST}$`));
    await page.locator(".app-bar-back").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
  });

  test("Back keeps the Library's order, as system Back does", async ({ page }) => {
    await narrow(page);
    await page.goto("/library");
    await hydrated(page);
    await page.getByRole("combobox", { name: "Sort" }).selectOption("oldest");
    await expect(page).toHaveURL(/sort=oldest/);
    await page.locator('a.card-link[href^="/e/"]').first().click();
    await expect(page).toHaveURL(/\/e\//);
    await page.locator(".app-bar-back").click();
    await expect(page).toHaveURL(/\/library\?sort=oldest$/);
    await expect(page.getByRole("combobox", { name: "Sort" })).toHaveValue("oldest");
  });
});

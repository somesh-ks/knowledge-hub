import type { PlayerDigestData } from "../src/types/contracts";
import { toRgba } from "./colors";
import { AUDIO_DIGEST, expect, hydrated, SILENT_DIGEST, test } from "./fixtures";

const FIRST_HEADLINE =
  "Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity";

test.describe("the briefing header", () => {
  test("renders the date, one meta line, the play chip and share", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    const meta = page.locator(".hero .meta > span");
    // The fixture recording is 36 seconds long, which a chip and a meta line round up to a minute.
    // Reading time is gone: the line says how many stories and how long they take to hear.
    await expect(meta).toHaveText(["12 stories", "1 min listen"]);
    const chip = page.locator("[data-play-digest]");
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-play-digest", "2026-10-07");
    await expect(chip.locator("[data-chip-label]")).toHaveText("1 min");
    await expect(chip).toHaveAccessibleName("Play the briefing, 1 min");
    await expect(chip).toHaveAttribute("data-state", "idle");
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: "Share this briefing" })).toBeVisible();
    await expect(page.locator(".hero-hint")).toHaveCount(0);
  });

  test("says stories, never items, anywhere a reader can see", async ({ page }) => {
    for (const path of ["/", SILENT_DIGEST, "/library"]) {
      await page.goto(path);
      await expect(page.locator("body")).not.toContainText(/\bitems?\b/i);
    }
  });

  test("a briefing without audio keeps a working chip and says nothing about it", async ({
    page,
  }) => {
    await page.goto(SILENT_DIGEST);
    const chip = page.locator("[data-play-digest]");
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
    await page.locator("[data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    const chip = page.locator("[data-play-digest]");
    await expect(chip).toHaveAttribute("data-state", "current");
    await expect(chip.locator("[data-chip-label]")).toHaveText("Playing");
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
    const button = page.getByRole("button", { name: "Share this briefing" });
    await expect
      .poll(async () => {
        await button.click();
        return page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared[0]);
      })
      .toBeTruthy();
    const shared = await page.evaluate(
      () => (window as unknown as { __shared: ShareData[] }).__shared[0],
    );
    // Today's page shares the dated address, so the link still opens this briefing next week.
    expect(shared?.url).toMatch(/\/d\/2026-10-07$/);
    expect(shared?.title).toBe("Wednesday 7 October, Singularity");
    await expect(button).not.toHaveAttribute("data-copied", /.*/);
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
    const button = page.locator("[data-share]");
    await expect(button).toHaveAccessibleName("Share this briefing");
    await expect(async () => {
      await button.click();
      await expect(button).toHaveAttribute("data-copied", "", { timeout: 500 });
    }).toPass();
    await expect(button).toHaveAccessibleName("Link copied");
    await expect(page.locator("[data-share-status]")).toHaveText("Link copied");
    await expect(button.locator(".share-done")).toBeVisible();
    await expect(button.locator(".share-icon")).toBeHidden();
    const copied = await page.evaluate(
      () => (window as unknown as { __copied: string[] }).__copied,
    );
    expect(copied[0]).toMatch(/\/d\/2026-10-05$/);
    // Two seconds later the button is itself again.
    await expect(button).toHaveAccessibleName("Share this briefing", { timeout: 4_000 });
    await expect(button).not.toHaveAttribute("data-copied", /.*/);
    await expect(page.locator("[data-share-status]")).toHaveText("");
  });
});

test.describe("sections and stories", () => {
  test("groups stories into sections in the fixed order", async ({ page }) => {
    await page.goto("/");
    const sections = page.locator("[data-chapter]");
    await expect(sections).toHaveCount(6);
    await expect(sections.locator("h2")).toHaveText([
      "Top picks",
      "Design Engineering",
      "AI Products",
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

  test("a story has one link: its source, in a new tab", async ({ page }) => {
    await page.goto("/");
    const first = page.locator(".story").first();
    await expect(first.locator("a")).toHaveCount(1);
    const link = first.locator(".source-link");
    // The link names the publisher; the host is only in its address and accessible name.
    await expect(link).toHaveText("Springlet Blog");
    await expect(link).toHaveAttribute("href", /^https:\/\/example\.com\//);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAccessibleName("Read at example.com, opens in a new tab");
    // The headline is a heading now, not a link.
    await expect(first.locator("h3")).toHaveText(FIRST_HEADLINE);
    await expect(first.locator("h3 a")).toHaveCount(0);
  });

  test("shows the publisher on the source link, no meta line and no author, and the why line", async ({
    page,
  }) => {
    await page.goto("/");
    const first = page.locator(".story").first();
    // Nothing sits above the headline: the story opens with its title.
    await expect(first.locator(".meta")).toHaveCount(0);
    await expect(first.locator("> *").first()).toHaveJSProperty("tagName", "H3");
    await expect(first).not.toContainText("Mara Lindqvist");
    await expect(first.locator(".source-link")).toHaveText("Springlet Blog");
    await expect(first.locator(".story-why")).toHaveText(
      "Why Copy the retargeting pattern for drawers and toasts.",
    );
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
    expect(data.cover.src512).toBe("/covers/2026-10-07-512.png");
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
  test.skip(
    ({ isMobile }) => !isMobile,
    "The tabs show below 80rem; the contents list replaces them",
  );

  test("link to each section and start on the first", async ({ page }) => {
    await page.goto("/");
    const tabs = page.locator('nav[aria-label="Sections"] .tab');
    await expect(tabs).toHaveText([
      "Top picks",
      "Design Engineering",
      "AI Products",
      "Research",
      "Launches",
      "Watch and listen",
    ]);
    await expect(tabs.first()).toHaveAttribute("href", "#c-top");
    await expect(tabs.first()).toHaveAttribute("aria-current", "true");
    await expect(page.locator('.tab[aria-current="true"]')).toHaveCount(1);
  });

  test("stick under the app bar while the sections scroll", async ({ page }) => {
    await page.goto("/");
    await page.locator("#c-research").scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 600);
    const strip = await page.locator(".tabs").boundingBox();
    const bar = await page.locator(".app-bar").boundingBox();
    expect(strip?.y).toBeCloseTo((bar?.y ?? 0) + (bar?.height ?? 0), 0);
    // Edge to edge on a phone: the strip runs past the gutters.
    expect(strip?.x).toBe(0);
    expect(strip?.width).toBe(390);
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

  test("a tapped tab jumps to its section, clear of the strip, and takes the mark", async ({
    page,
  }) => {
    await page.goto("/");
    const tab = page.locator(".tab", { hasText: "Research" });
    await tab.click();
    await expect(page).toHaveURL(/#c-research$/);
    await expect(tab).toHaveAttribute("aria-current", "true");
    await expect(page.locator('.tab[aria-current="true"]')).toHaveCount(1);
    const heading = await page.locator("#c-research").boundingBox();
    const strip = await page.locator(".tabs").boundingBox();
    expect(heading?.y ?? 0).toBeGreaterThanOrEqual((strip?.y ?? 0) + (strip?.height ?? 0));
    expect(heading?.y ?? 999).toBeLessThan(260);
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

test.describe("earlier briefings", () => {
  test("lists the earlier briefings and a way to all of them", async ({ page }) => {
    await page.goto("/");
    // A shelf of covers, not a list: the same card the Library uses.
    await expect(
      page.getByRole("heading", { level: 2, name: "Earlier", exact: true }),
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
    await expect(weekly.locator(".card-facts")).toHaveText("Weekly, 14 stories, 8 min");
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
    await expect(head.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(head.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(
      head.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute("content", "black-translucent");
    await expect(head.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(head.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "light dark",
    );
    await expect(head.locator('meta[name="theme-color"]')).toHaveCount(2);
    await expect(head.locator('meta[name="theme-color"][media*="light"]')).toHaveAttribute(
      "content",
      "#ffffff",
    );
    await expect(head.locator('meta[name="theme-color"][media*="dark"]')).toHaveAttribute(
      "content",
      "#202124",
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

  test("uses an opaque background on the sticky app bar", async ({ page, isMobile }) => {
    test.skip(!isMobile, "From 64rem the side navigation replaces the app bar");
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

  test("updates the title on every page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Wednesday 7 October, Singularity");
    await page.goto("/library");
    await expect(page).toHaveTitle("Library, Singularity");
  });
});

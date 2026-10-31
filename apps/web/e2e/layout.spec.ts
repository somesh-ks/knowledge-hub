import { expect, hydrated, ROUTES, SILENT_DIGEST, targetSize, test } from "./fixtures";

const WIDTHS = [320, 390, 820, 1280] as const;

/** The app's other pages, beside the reading routes, that every sweep covers too. */
const PAGES = [
  "/create",
  "/settings",
  "/settings/daily",
  "/settings/weekly",
  "/settings/preferences",
  "/settings/preferences?view=structure",
  "/settings/categories",
  "/settings/categories/design",
  "/settings/voice",
  "/settings/sounds",
  "/settings/about",
  "/settings/privacy",
  "/e/ep-20261007-1930",
  // Left out until 2026-10-24, so its chart and table switch answered a touch across 36px unseen.
  "/admin/costs",
  "/admin/health",
];

/** Eighty words: the longest summary the voice allows. */
const LONG_SUMMARY = Array.from({ length: 16 }, () => "Five plain words fit here.").join(" ");
const LONG_HEADLINE =
  "A headline long enough to run across three full lines on a narrow phone, with a comma, a number like 2026 and nothing shortened";
const LONG_HOST = "an-unusually-long-subdomain.publications.a-publisher-network.example.co.uk";

test.describe("layout", () => {
  for (const width of WIDTHS) {
    test(`nothing scrolls sideways at ${width}px`, { tag: "@both" }, async ({ page }) => {
      // Some twenty pages, each loaded once.
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      for (const path of [...ROUTES.map((route) => route.path), ...PAGES]) {
        await page.goto(path);
        // Against the width asked for, not the page's own clientWidth: a page that outgrows the phone
        // widens the layout viewport too (Chromium's mobile zoom-out), so it always fits itself.
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scroll, `${path} at ${width}px`).toBeLessThanOrEqual(width);
      }
    });
  }

  test("every control answers a touch across at least 44px in both directions", {
    tag: "@both",
  }, async ({ page }) => {
    // Every headline is a link, and every page of the app is probed: a minute or two of hit tests.
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 900 });
    for (const path of ["/", "/library", SILENT_DIGEST, "/offline", ...PAGES]) {
      await page.goto(path);
      const small: string[] = [];
      const controls = "a[href], button, summary, select, input:not([type=hidden])";
      for (const control of await page.locator(controls).all()) {
        if (!(await control.isVisible())) continue;
        // The skip link is a keyboard control and only shows on focus.
        if (await control.evaluate((node) => node.matches(".skip-link"))) continue;
        // A control that takes no touch by design, as a card's dots on a phone (D264: a hold opens
        // the menu), is for a screen reader and a keyboard, so it has no target to measure.
        if (await control.evaluate((node) => getComputedStyle(node).pointerEvents === "none")) {
          continue;
        }
        // A choice drawn as its label (a chip, a segment, a switch) is pressed on the label.
        const label = control.locator("xpath=self::input/ancestor::label[1]");
        const size = await targetSize((await label.count()) > 0 ? label : control);
        if (size.width < 44 || size.height < 44) {
          const label = await control.evaluate((node) =>
            (node.getAttribute("aria-label") ?? node.textContent ?? "").trim().slice(0, 40),
          );
          small.push(`"${label}" ${size.width}x${size.height}`);
        }
      }
      expect(small, `controls under 44px on ${path}`).toEqual([]);
    }
  });

  // A text link in small text is an inline box shorter than its line, and its hit layer was sized
  // from the line (42px, 2026-10-27). Probed at both sizes, a point 21.5px above and below the
  // centre must still reach the link.
  test("a text link answers a touch across 44px at both sizes", { tag: "@both" }, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const short: string[] = [];
    for (const path of ["/settings/privacy", "/settings/about", "/settings/daily", ...PAGES]) {
      await page.goto(path);
      for (const link of await page.locator(".text-link").all()) {
        if (!(await link.isVisible())) continue;
        const reached = await link.evaluate((node) => {
          node.scrollIntoView({ block: "center", inline: "center" });
          const rects = [...node.getClientRects()];
          // The first line's box: a link that wraps is probed on its first fragment.
          const rect = rects[0] ?? node.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return [-21.5, 21.5].every((dy) => {
            const found = document.elementFromPoint(x, y + dy);
            return found !== null && (found === node || node.contains(found));
          });
        });
        if (!reached) short.push(`${path} "${(await link.textContent())?.trim().slice(0, 30)}"`);
      }
    }
    expect([...new Set(short)]).toEqual([]);
  });

  test("the wide bottom bar's buttons and volume answer a touch across 44px", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await hydrated(page);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    const controls = page.locator(".player-dock button, .player-dock .dock-volume-level");
    // Open, previous, play, next, mute, and the volume range.
    expect(await controls.count()).toBeGreaterThanOrEqual(6);
    const small: string[] = [];
    for (const control of await controls.all()) {
      if (!(await control.isVisible())) continue;
      const size = await targetSize(control);
      if (size.width < 44 || size.height < 44) {
        const label = await control.evaluate(
          (node) => node.getAttribute("aria-label") ?? node.className,
        );
        small.push(`"${label}" ${size.width}x${size.height}`);
      }
    }
    expect(small).toEqual([]);
  });

  test("the reading column holds the measure on a wide screen", { tag: "@desktop" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/");
    const column = await page
      .locator("main")
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(column).toBeLessThanOrEqual(640);
    const summary = await page
      .locator(".story-summary")
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        const probe = document.createElement("span");
        probe.textContent = "0";
        probe.style.font = style.font;
        probe.style.position = "absolute";
        node.append(probe);
        const zero = probe.getBoundingClientRect().width;
        probe.remove();
        return { family: style.fontFamily, characters: node.getBoundingClientRect().width / zero };
      });
    expect(summary.family).toContain("Google Sans Flex");
    // No line of a summary runs past about 68 characters.
    expect(summary.characters).toBeLessThanOrEqual(69);
  });

  test("the contents list replaces the section tabs from 80rem", { tag: "@desktop" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const aside = page.getByRole("navigation", { name: "Contents" });
    await expect(aside).toBeVisible();
    await expect(aside.locator(".aside-link")).toHaveCount(6);
    await expect(aside.locator(".aside-link").first()).toHaveAttribute("href", "#c-top");
    // The contents list names the sections and says nothing of time.
    await expect(aside.locator(".aside-link").first()).toHaveText("Top picks");
    await expect(aside.locator(".aside-length")).toHaveCount(0);
    await expect(page.locator(".tabs")).toBeHidden();
    // It sits past the reading column and after it in the document.
    const main = await page.locator("main").boundingBox();
    const box = await aside.boundingBox();
    expect(box?.x ?? 0).toBeGreaterThan((main?.x ?? 0) + (main?.width ?? 0));
    expect(
      await page.evaluate(() => {
        const list = document.querySelector(".aside");
        const column = document.querySelector("main");
        return Boolean(
          list && column && column.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(aside).toBeHidden();
    await expect(page.locator(".tabs")).toBeVisible();
  });

  test("the contents list marks the section in view and stays put while the page scrolls", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const current = page.locator('.aside-link[aria-current="true"]');
    await expect(current).toHaveText(/Top picks/);
    await page.evaluate(() => {
      document.querySelector("#c-research")?.scrollIntoView({ block: "start" });
    });
    await expect(current).toHaveText(/Research/);
    await expect(current).toHaveCount(1);
    // On the window's middle line, between the top chrome and the bottom of the window, whatever the
    // scroll: where to go next is always in the same place.
    const middle = () =>
      page.evaluate(() => {
        const top = document.querySelector(".aside-title")?.getBoundingClientRect().top ?? 0;
        const bottom = document.querySelector(".aside ul")?.getBoundingClientRect().bottom ?? 0;
        return (top + bottom) / 2;
      });
    expect(Math.abs((await middle()) - 450)).toBeLessThan(40);
    await page.evaluate(() => {
      document.querySelector("#c-launches")?.scrollIntoView({ block: "start" });
    });
    expect(Math.abs((await middle()) - 450)).toBeLessThan(40);
    await page.locator(".aside-link", { hasText: "Launches" }).click();
    await expect(page).toHaveURL(/#c-launches$/);
    await expect(current).toHaveText(/Launches/);
    await expect(page.locator("#c-launches")).toBeInViewport();
  });

  test("the contents list marks the last section at the end of the page, though it cannot reach the top", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const current = page.locator('.aside-link[aria-current="true"]');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(current).toHaveText(/Watch and listen/);
    // Back up the page, the section at the reading line takes the mark again.
    await page.evaluate(() => {
      document.querySelector("#c-research")?.scrollIntoView({ block: "start" });
    });
    await expect(current).toHaveText(/Research/);
  });

  test("the contents list has no listening lengths, with or without audio", {
    tag: "@desktop",
  }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const path of [SILENT_DIGEST, "/"]) {
      await page.goto(path);
      await expect(page.locator(".aside-link").first()).toBeVisible();
      await expect(page.locator(".aside-length")).toHaveCount(0);
    }
  });

  test("every story chip keeps its whole 44px target, clear of the why line and the publisher", async ({
    page,
  }) => {
    for (const width of [360, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const misses = await page.evaluate(() => {
        const out: string[] = [];
        for (const chip of document.querySelectorAll<HTMLElement>(".story [data-play-item]")) {
          chip.scrollIntoView({ block: "center" });
          const box = chip.getBoundingClientRect();
          for (const y of [box.top - 3, box.bottom + 3]) {
            const hit = document.elementFromPoint(box.left + box.width / 2, y);
            if (!hit || !chip.contains(hit)) out.push(`${chip.dataset.playItem} ${hit?.className}`);
          }
        }
        return out;
      });
      expect(misses, `${width}`).toEqual([]);
    }
  });

  test("long content holds at 320px: a three-line headline, an 80-word summary, a long host", async ({
    page,
  }) => {
    // A publisher of a usual length reads whole on a 360px phone: beside the chip and the controls
    // it once showed about six letters (owner, 2026-10-23).
    await page.setViewportSize({ width: 360, height: 700 });
    await page.goto("/");
    const name = page.locator(".story").first().locator(".source-link > span").first();
    await expect(name).toHaveText("Springlet Blog");
    expect(await name.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    const story = page.locator(".story").nth(1);
    // Where the story's controls sit in their row, and how tall the row is: a long publisher must
    // change neither (it once pushed them to an orphan second line; owner, 2026-10-22).
    const controlsPlace = async () => {
      const [row, controls] = await Promise.all([
        story.locator(".story-actions").boundingBox(),
        story.locator(".story-controls").boundingBox(),
      ]);
      return {
        height: row?.height ?? 0,
        top: (controls?.y ?? 0) - (row?.y ?? 0),
        end: (controls?.x ?? 0) + (controls?.width ?? 0),
      };
    };
    const before = await controlsPlace();
    await story.evaluate(
      (node, content) => {
        const title = node.querySelector("h3");
        const summary = node.querySelector(".story-summary");
        const host = node.querySelector(".source-link > span");
        if (title) title.textContent = content.headline;
        if (summary) summary.textContent = content.summary;
        if (host) host.textContent = content.host;
        // A story with no author: the publisher stands alone.
        node.querySelector(".meta > span:nth-child(2)")?.remove();
      },
      { headline: LONG_HEADLINE, summary: LONG_SUMMARY, host: LONG_HOST },
    );
    expect(LONG_SUMMARY.split(" ")).toHaveLength(80);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

    const lines = await story.locator("h3").evaluate((node) => {
      const style = getComputedStyle(node);
      return Math.round(node.getBoundingClientRect().height / Number.parseFloat(style.lineHeight));
    });
    expect(lines).toBeGreaterThanOrEqual(3);

    // The chip keeps its size; the host gives way with an ellipsis and its glyph stays in view.
    const chip = await story.locator(".chip").boundingBox();
    const idleChip = await page.locator(".story").nth(2).locator(".chip").boundingBox();
    expect(chip?.width).toBeCloseTo(idleChip?.width ?? 0, 0);
    const link = await story.locator(".source-link").boundingBox();
    expect((link?.x ?? 0) + (link?.width ?? 0)).toBeLessThanOrEqual(320 - 16 + 0.5);
    const host = story.locator(".source-link > span").first();
    expect(await host.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    await story.locator(".source-link").scrollIntoViewIfNeeded();
    await expect(host).toBeInViewport({ ratio: 1 });
    const after = await controlsPlace();
    expect(after.height).toBeCloseTo(before.height, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.end).toBeCloseTo(before.end, 0);
    // Every part of the story stays inside the column. The last control's 44px target reaches into
    // the gutter by design, so its glyph lines up with the column's edge (story-controls.css): the
    // glyph is measured, not the target.
    const widest = await story.evaluate((node) =>
      Math.max(
        ...[...node.querySelectorAll("*")]
          .filter(
            (child) =>
              !child.matches(
                ".story-controls > :last-child, .story-controls > :last-child > button",
              ),
          )
          .map((child) => child.getBoundingClientRect().right),
      ),
    );
    expect(widest).toBeLessThanOrEqual(320 - 16 + 0.5);
  });

  test("fonts are self-hosted with a metric-matched fallback", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const faces = await page.evaluate(() =>
      [...document.fonts].map((face) => `${face.family}:${face.status}`),
    );
    expect(faces.join(" ")).toContain("Google Sans Flex Variable");
    expect(faces.join(" ")).toContain("Google Sans Flex Fallback");
    expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(true);
    expect(requests.some((url) => url.endsWith(".woff2"))).toBe(true);
  });

  test("forced colors keeps the current story and section marked", { tag: "@desktop" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    // The player clears story states as it hydrates; write ours after it has.
    await hydrated(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    // The current story is marked by its chip (the headline keeps its ink in every mode).
    const chip = page.locator(".story").nth(1).locator("[data-play-item]");
    const edge = () => chip.evaluate((node) => getComputedStyle(node).borderTopColor);
    const before = await edge();
    await chip.evaluate((node) => node.setAttribute("data-state", "current"));
    await page.waitForTimeout(250);
    expect(await edge()).not.toBe(before);
    // The section in view keeps an edge where its fill is dropped.
    const outline = await page
      .locator('.aside-link[aria-current="true"]')
      .evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(outline).toBe("solid");
  });

  test("a balanced headline never breaks a hyphenated word at its hyphen", async ({ page }) => {
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ["/d/2026-10-05", "/e/ep-20261007-1930"]) {
        await page.goto(path);
        const title = page.locator(":is(.story-title, .episode-highlight-title)", {
          hasText: "mid-range",
        });
        const word = title.first().locator(".no-break", { hasText: "mid-range" });
        await expect(word, `${path} at ${width}`).toHaveCount(1);
        expect(await word.evaluate((node) => node.getClientRects().length)).toBe(1);
      }
    }
  });
});

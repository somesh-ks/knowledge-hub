import { expect, hydrated, ROUTES, SILENT_DIGEST, targetSize, test } from "./fixtures";

const WIDTHS = [320, 390, 820, 1280] as const;

/** Eighty words: the longest summary the voice allows. */
const LONG_SUMMARY = Array.from({ length: 16 }, () => "Five plain words fit here.").join(" ");
const LONG_HEADLINE =
  "A headline long enough to run across three full lines on a narrow phone, with a comma, a number like 2026 and nothing shortened";
const LONG_HOST = "an-unusually-long-subdomain.publications.a-publisher-network.example.co.uk";

test.describe("layout", () => {
  for (const width of WIDTHS) {
    test(`nothing scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ROUTES) {
        await page.goto(route.path);
        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll, `${route.path} at ${width}px`).toBeLessThanOrEqual(overflow.client);
      }
    });
  }

  test("every control answers a touch across at least 44px in both directions", async ({
    page,
  }) => {
    // Every headline is a link now, so there are a dozen more controls to probe on a briefing.
    test.slow();
    await page.setViewportSize({ width: 390, height: 900 });
    for (const path of ["/", "/library", SILENT_DIGEST, "/offline"]) {
      await page.goto(path);
      const small: string[] = [];
      for (const control of await page.locator("a[href], button, summary, select").all()) {
        if (!(await control.isVisible())) continue;
        // The skip link is a keyboard control and only shows on focus.
        if (await control.evaluate((node) => node.matches(".skip-link"))) continue;
        const size = await targetSize(control);
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

  test("the wide bottom bar's buttons and volume answer a touch across 44px", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "The full bar with a mouse is a desktop layout");
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

  test("the reading column holds the measure on a wide screen", async ({ page }) => {
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

  test("the contents list replaces the section tabs from 80rem", async ({ page }) => {
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

  test("the contents list starts level with the first section's heading", async ({ page }) => {
    for (const width of [1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.locator(".aside")).toHaveAttribute("style", /--aside-start/);
      const words = (selector: string) =>
        page
          .locator(selector)
          .first()
          .evaluate((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect().top;
          });
      const title = await words(".aside-title");
      const heading = await words("[data-chapter] > h2");
      expect(Math.abs(title - heading), `${width}`).toBeLessThan(6);
    }
  });

  test("the contents list marks the section in view and stays put while the page scrolls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const current = page.locator('.aside-link[aria-current="true"]');
    await expect(current).toHaveText(/Top picks/);
    await page.evaluate(() => {
      document.querySelector("#c-research")?.scrollIntoView({ block: "start" });
    });
    await expect(current).toHaveText(/Research/);
    await expect(current).toHaveCount(1);
    const box = await page.locator(".aside").boundingBox();
    // Stuck near the top, under the same room the page keeps above its first block, whatever the
    // scroll: it never floats in the middle of the window.
    expect(box?.y ?? 0).toBeCloseTo(48, -1);
    await page.locator(".aside-link", { hasText: "Launches" }).click();
    await expect(page).toHaveURL(/#c-launches$/);
    await expect(current).toHaveText(/Launches/);
    await expect(page.locator("#c-launches")).toBeInViewport();
  });

  test("the contents list marks the last section at the end of the page, though it cannot reach the top", async ({
    page,
  }) => {
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

  test("the contents list has no listening lengths, with or without audio", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const path of [SILENT_DIGEST, "/"]) {
      await page.goto(path);
      await expect(page.locator(".aside-link").first()).toBeVisible();
      await expect(page.locator(".aside-length")).toHaveCount(0);
    }
  });

  test("on a phone the header stacks the same way for any title, down to 320px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    for (const path of ["/", "/e/ep-20261007-1930"]) {
      await page.goto(path);
      const cover = await page.locator(".hero .cover").boundingBox();
      const heading = await page.locator(".hero h1").boundingBox();
      const facts = await page.locator(".hero-facts").boundingBox();
      const chip = await page.locator(".hero [data-play-digest]").boundingBox();
      const more = await page.getByRole("button", { name: "More actions" }).boundingBox();
      expect(cover?.width, path).toBeCloseTo(88, 0);
      // The cover with More at the far end of its row, then the title, its facts and Play, each
      // under the one before and each from the column's edge.
      expect(more?.y ?? 999, path).toBeLessThan((cover?.y ?? 0) + (cover?.height ?? 0) / 2);
      const edge = await page.evaluate(
        () => document.querySelector("main")?.getBoundingClientRect().right ?? 0,
      );
      expect((more?.x ?? 0) + (more?.width ?? 0), path).toBeGreaterThan(edge);
      expect(heading?.y ?? 0, path).toBeGreaterThan((cover?.y ?? 0) + (cover?.height ?? 0));
      expect(facts?.y ?? 0, path).toBeGreaterThanOrEqual(
        (heading?.y ?? 0) + (heading?.height ?? 0) - 1,
      );
      expect(chip?.y ?? 0, path).toBeGreaterThan((facts?.y ?? 0) + (facts?.height ?? 0));
      for (const box of [heading, facts, chip]) expect(box?.x, path).toBeCloseTo(cover?.x ?? -1, 0);
    }
  });

  test("from 40rem Play sits beside the cover on its foot line, under the date", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto("/");
    const cover = await page.locator(".hero .cover").boundingBox();
    const chip = await page.locator(".hero [data-play-digest]").boundingBox();
    const facts = await page.locator(".hero-facts").boundingBox();
    expect(cover?.width).toBeCloseTo(160, 0);
    expect(chip?.x ?? 0).toBeGreaterThan((cover?.x ?? 0) + (cover?.width ?? 0));
    expect(chip?.y ?? 0).toBeGreaterThan((facts?.y ?? 0) + (facts?.height ?? 0));
    // Its foot within a few pixels of the cover's.
    const coverFoot = (cover?.y ?? 0) + (cover?.height ?? 0);
    expect(Math.abs((chip?.y ?? 0) + (chip?.height ?? 0) - coverFoot)).toBeLessThan(4);
  });

  test("hairlines between stories stay inside the text column", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const rule = await page
      .locator(".story")
      .nth(1)
      .evaluate((node) => {
        const style = getComputedStyle(node, "::before");
        const box = node.getBoundingClientRect();
        return {
          left: box.left + Number.parseFloat(style.left) - box.left,
          width: Number.parseFloat(style.width),
          row: box.width,
          height: style.height,
          // The page's own width: a desktop browser takes a scrollbar out of the 390.
          page: document.documentElement.clientWidth,
        };
      });
    // The line starts and ends where the text does: no bleed past the gutters.
    expect(rule.left).toBeCloseTo(0, 0);
    expect(rule.width).toBeCloseTo(rule.row, 0);
    expect(rule.width).toBeLessThan(rule.page);
    expect(rule.height).toBe("1px");
    // The first story of a section has no rule: its section header is above it.
    expect(
      await page
        .locator(".story")
        .first()
        .evaluate((node) => getComputedStyle(node, "::before").content),
    ).toBe("none");
  });

  test("there is more room above a section header than below it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const gaps = await page
      .locator("[data-chapter]")
      .nth(1)
      .evaluate((section) => {
        const heading = section.querySelector("h2")?.getBoundingClientRect();
        const first = section.querySelector(".story .meta")?.getBoundingClientRect();
        const previous = section.previousElementSibling?.querySelector(".story:last-child");
        const last = previous?.querySelector(".story-actions")?.getBoundingClientRect();
        return {
          above: (heading?.top ?? 0) - (last?.bottom ?? 0),
          below: (first?.top ?? 0) - (heading?.bottom ?? 0),
        };
      });
    expect(gaps.above).toBeGreaterThan(gaps.below * 1.5);
  });

  test("long content holds at 320px: a three-line headline, an 80-word summary, a long host", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    const story = page.locator(".story").nth(1);
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
    await expect(story.locator(".source-link .icon")).toBeInViewport({ ratio: 1 });
    // Every part of the story stays inside the column.
    const widest = await story.evaluate((node) =>
      Math.max(
        ...[...node.querySelectorAll("*")].map((child) => child.getBoundingClientRect().right),
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

  test("type holds to two weights, with the date and section headings regular and headlines medium", async ({
    page,
  }) => {
    await page.goto("/");
    const weight = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((node) => getComputedStyle(node).fontWeight);
    expect(await weight("h1")).toBe("400");
    expect(await weight("[data-chapter] h2")).toBe("400");
    expect(await weight(".story h3")).toBe("500");
    expect(await weight(".story-summary")).toBe("400");
    expect(await weight(".card-title")).toBe("500");
    const weights = await page
      .locator("main *")
      .evaluateAll((nodes) => [...new Set(nodes.map((node) => getComputedStyle(node).fontWeight))]);
    expect(weights.sort()).toEqual(["400", "500"]);
  });

  test("reduced motion keeps the layout and removes movement", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const durations = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        enter: style.getPropertyValue("--duration-enter").trim(),
        sheet: style.getPropertyValue("--duration-sheet-in").trim(),
        state: style.getPropertyValue("--duration-state").trim(),
      };
    });
    expect(Number.parseFloat(durations.enter)).toBeCloseTo(0.01, 3);
    expect(Number.parseFloat(durations.sheet)).toBeCloseTo(0.01, 3);
    expect(
      Number.parseFloat(durations.state) * (durations.state.endsWith("ms") ? 1 : 1000),
    ).toBeCloseTo(200, 0);
    // A playing chip's bars hold still, at three heights.
    const chip = page.locator("[data-play-item]").first();
    await chip.evaluate((node) => {
      node.setAttribute("data-state", "current");
      node.setAttribute("data-playing", "true");
    });
    expect(
      await chip
        .locator(".chip-bars > i")
        .first()
        .evaluate((node) => getComputedStyle(node).animationName),
    ).toBe("none");
  });

  test("forced colors keeps the current story and section marked", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    // The player clears story states as it hydrates; write ours after it has.
    await hydrated(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    const story = page.locator(".story").nth(1);
    const before = await story.locator("h3").evaluate((node) => getComputedStyle(node).color);
    await story.evaluate((node) => node.setAttribute("data-state", "current"));
    await page.waitForTimeout(250);
    const after = await story.locator("h3").evaluate((node) => getComputedStyle(node).color);
    expect(after).not.toBe(before);
    // The section in view keeps an edge where its fill is dropped.
    const outline = await page
      .locator('.aside-link[aria-current="true"]')
      .evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(outline).toBe("solid");
  });

  test("scroll behavior lives in the stylesheet", async ({ page }) => {
    await page.goto("/");
    const overscroll = await page.evaluate(
      () => getComputedStyle(document.documentElement).overscrollBehaviorY,
    );
    expect(overscroll).toBe("none");
  });

  test("uses the safe area variables with a zero fallback", async ({ page }) => {
    await page.goto("/");
    const safe = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return ["--safe-top", "--safe-right", "--safe-bottom", "--safe-left"].map((name) =>
        style.getPropertyValue(name).trim(),
      );
    });
    // A zero inset is a real answer: every variable resolves, and the layout works at 0px.
    expect(safe).toEqual(["0px", "0px", "0px", "0px"]);
  });
});

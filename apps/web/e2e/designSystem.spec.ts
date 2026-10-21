import type { Page } from "@playwright/test";
import { AUDIO_DIGEST, expect, hydrated, ROUTES, SITE_PAGES, test } from "./fixtures";

/**
 * The 8pt system, as the browser draws it. styles.test.ts holds the stylesheets to the scale; this
 * holds what they compute to, where a calc(), an em, a token chain or a component's own rule can
 * still land between steps (a 6px or 10px gap reads as two rows touching). It checks the grid
 * only, never a value or a layout.
 */

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** The 1px border compensations: a box that sits inside a hairline keeps the grid outside it. */
const HAIRLINE = [
  ".chip",
  ".filter-chip",
  ".sort-field",
  ".search-field",
  ".tab",
  ".tabs",
  ".app-nav-create",
  ".create-fab",
  ".manage-input",
  ".sheet-input",
];

/**
 * Boxes centred on a neighbour by half the difference of two sizes (a 44px target on a 24px glyph,
 * a control in its row, a 4px track on its line): the offset follows those sizes, not the scale.
 * Drawn glyphs (the playing bars) and the visually hidden text are not spacing at all.
 */
const EXEMPT = [
  ".sr-only",
  ".chip-bars",
  ".story-menu",
  ".hero-more",
  ".scrubber-track",
  ".player-dock",
  // An optical nudge sized by the glyph's own side bearing, so its edge meets the switches'.
  ".row-action .icon",
];

const PAGES = [
  ...new Set([
    ...ROUTES.map((route) => route.path),
    ...SITE_PAGES,
    "/settings/topics/design",
    "/settings/topics/design?view=preferences",
  ]),
];

/** Every visible element's spacing that is off the 4px grid, as `selector property value`. */
async function offGrid(page: Page): Promise<string[]> {
  // An opening surface settles first; a looping or scroll-driven animation never ends.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.timeline !== document.timeline ||
          !Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
      ),
  );
  return page.evaluate(
    ([hairline, exempt]) => {
      const properties = [
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "row-gap",
        "column-gap",
      ];
      const found: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("body *")) {
        if (!element.checkVisibility?.({ visibilityProperty: true })) continue;
        const style = element.computedStyleMap();
        for (const property of properties) {
          // The computed value: `auto` and `normal` stay keywords, a length resolves to px.
          const value = style.get(property);
          if (!(value instanceof CSSUnitValue) || value.unit !== "px") continue;
          const px = Math.abs(value.value);
          const rest = px % 4;
          if (rest < 0.01 || 4 - rest < 0.01) continue;
          const nearHairline = Math.abs(rest - 1) < 0.01 || Math.abs(rest - 3) < 0.01;
          if (nearHairline && hairline.some((selector) => element.closest(selector))) continue;
          if (exempt.some((selector) => element.matches(selector))) continue;
          const name = `${element.tagName.toLowerCase()}${[...element.classList].map((c) => `.${c}`).join("")}`;
          found.push(`${name} ${property} ${value.value}px`);
        }
      }
      return [...new Set(found)];
    },
    [HAIRLINE, EXEMPT] as const,
  );
}

test.describe("the 8pt spacing system", () => {
  test("every page spaces on the 4px grid", { tag: "@both" }, async ({ page }) => {
    test.setTimeout(120_000);
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect.soft(await offGrid(page), path).toEqual([]);
    }
  });

  test("open surfaces space on the 4px grid", { tag: "@both" }, async ({ page }) => {
    await page.route("**/api/site-icon**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
    );

    // The full-screen player.
    await page.goto(AUDIO_DIGEST);
    await hydrated(page);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await page.getByRole("button", { name: /^Player: / }).click();
    await expect(page.locator("html")).toHaveAttribute("data-player", "open");
    expect.soft(await offGrid(page), "the open player").toEqual([]);

    // A briefing's More actions menu.
    await page.goto(AUDIO_DIGEST);
    await hydrated(page);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menu", { name: "More actions" })).toBeVisible();
    expect.soft(await offGrid(page), "the More actions menu").toEqual([]);

    // A Library row's More actions menu.
    await page.goto("/library");
    await hydrated(page);
    await page
      .getByRole("button", { name: /^More actions for / })
      .first()
      .click();
    await expect(page.getByRole("menu").first()).toBeVisible();
    expect.soft(await offGrid(page), "a Library row's menu").toEqual([]);

    // The Add source panel with the topic's suggested sources.
    await page.goto("/settings/topics/design");
    await expect(page.locator("[data-topics]")).toHaveAttribute("data-ready", "");
    await page
      .getByRole("button", { name: /^Add source to / })
      .first()
      .click();
    const panel = page.getByRole("dialog", { name: "Add a source" });
    await expect(panel).toBeVisible();
    expect(await offGrid(page), "the Add source panel").toEqual([]);
  });
});

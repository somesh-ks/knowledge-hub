import type { Page } from "@playwright/test";
import { MENU_TILES_MAX, menuHasTiles } from "../src/design-system/menu";
import { AUDIO_DIGEST, expect, hydrated, openRowMenu, ROUTES, SITE_PAGES, test } from "./fixtures";
import { openPicker, pickerList } from "./picker";

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
  ".select-tonal",
  ".search-field",
  ".tab",
  ".tabs",
  ".app-nav-create",
  ".create-fab",
  ".field-input",
];

/**
 * Boxes centred on a neighbour by half the difference of two sizes (a 44px target on a 24px glyph,
 * a control in its row, a 4px track on its line): the offset follows those sizes, not the scale.
 * Drawn glyphs (the playing bars) and the visually hidden text are not spacing at all.
 */
const EXEMPT = [
  ".sr-only",
  // A phone sheet's Close is visually hidden (D144), as the utility above.
  ".sheet-head > .icon-btn",
  ".chip-bars",
  ".story-menu",
  ".hero-more",
  ".scrubber-track",
  ".player-dock",
  // A 44px target around an 18px box, reaching past it so the box meets a card's edge (topics.css).
  ".topic-panel .source-check",
  // An optical nudge sized by the glyph's own side bearing (--ink-end, D187), so its ink meets the
  // row's end: a row's chevron, a select's or a multi-select's in a row, Create's More options and
  // an icon button that ends a row.
  ".row-action .icon-glyph",
  ".settings-row .value-select > select.field-input",
  ".settings-row .multiselect-trigger",
  ".create-more-chevron",
  ".icon-btn-end",
  // An optical pad sized by the font's metrics, so the emoji's ink sits in its cell's centre.
  ".emoji-cell",
  // Centred on the title's first line by the label's leading (banner.css); kept for any page that
  // shows a banner (the catalogue that always showed one is gone).
  ".banner-notice > .icon-glyph",
];

const PAGES = [
  ...new Set([
    ...ROUTES.map((route) => route.path),
    ...SITE_PAGES,
    "/settings/categories/design",
    "/settings/categories/design?view=preferences",
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

/**
 * A card's rows that start off the edge its other content starts on, as `row starts +16px`. A
 * topic's source rows once sat 16px inside the Sources heading, the search field and the count line
 * above them, so the list looked squeezed (owner, 2026-11-05). A card is any rounded, filled box of
 * the page; its section headings, hint lines, fields and rows are compared with each other, never
 * with a pinned value. A row's edge is its first glyph, word or picture; a field's is its box.
 */
async function offCardEdge(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const shown = (element: Element) =>
      element.checkVisibility?.({ visibilityProperty: true }) &&
      element.getBoundingClientRect().width > 0;
    const filled = (element: Element) =>
      getComputedStyle(element).backgroundColor !== "rgba(0, 0, 0, 0)";
    const name = (element: Element) =>
      `${element.tagName.toLowerCase()}${[...element.classList].map((c) => `.${c}`).join("")}`;
    const cards = [...document.querySelectorAll("main *")].filter((element) => {
      const box = element.getBoundingClientRect();
      return (
        shown(element) &&
        filled(element) &&
        parseFloat(getComputedStyle(element).borderTopLeftRadius) >= 16 &&
        box.width >= 240 &&
        box.height >= 100 &&
        !element.matches("a, button, input, select, textarea, label, img, .search-field")
      );
    });
    const FIELD = ".search-wrap, .field-input, select, textarea";
    const found: string[] = [];
    for (const card of cards) {
      const all = [
        ...card.querySelectorAll(
          `h2, h3, li, .settings-row, .row-action, .settings-hint, ${FIELD}`,
        ),
      ].filter(
        (item) =>
          shown(item) &&
          !cards.some((inner) => inner !== card && card.contains(inner) && inner.contains(item)),
      );
      const items = all.filter(
        (item) => !all.some((outer) => outer !== item && outer.contains(item)),
      );
      const starts = items.flatMap((item) => {
        if (item.matches(FIELD)) return [{ item, left: item.getBoundingClientRect().left }];
        const lefts: number[] = [];
        const walker = document.createTreeWalker(
          item,
          NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        );
        for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
          const element = node instanceof Element ? node : node.parentElement;
          if (!element || !shown(element) || element.closest(".sr-only")) continue;
          if (node instanceof Text && node.textContent?.trim()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            lefts.push(range.getBoundingClientRect().left);
          } else if (
            node instanceof Element &&
            node.matches("img, svg, .suggest-box, .source-initial")
          ) {
            lefts.push(node.getBoundingClientRect().left);
          }
        }
        return lefts.length ? [{ item, left: Math.min(...lefts) }] : [];
      });
      if (starts.length < 2) continue;
      const tally = new Map<number, number>();
      for (const { left } of starts)
        tally.set(Math.round(left), (tally.get(Math.round(left)) ?? 0) + 1);
      const edge = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      for (const { item, left } of starts) {
        if (Math.abs(left - edge) > 1)
          found.push(`${name(card)} > ${name(item)} starts ${Math.round(left - edge)}px`);
      }
    }
    return [...new Set(found)];
  });
}

/**
 * Sideways scrollers whose cut ends have no fade, by name. The Library's kind chips once stopped
 * hard at the view switch, so a chip cut in half read as broken (owner, 2026-11-05). A scroller is a
 * box that scrolls sideways and lays its content out in one line, whether or not this window is
 * narrow enough to cut it; its fade is .scroll-fade-inline (primitives.css), drawn as a mask.
 */
async function unfadedScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => {
        if (!element.checkVisibility?.({ visibilityProperty: true })) return false;
        const style = getComputedStyle(element);
        if (!/auto|scroll/.test(style.overflowX)) return false;
        const oneLine =
          style.display.includes("flex") &&
          style.flexDirection.startsWith("row") &&
          style.flexWrap === "nowrap";
        return (
          (oneLine || element.scrollWidth > element.clientWidth + 1) && style.maskImage === "none"
        );
      })
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}${[...element.classList].map((c) => `.${c}`).join("")}`,
      ),
  );
}

test.describe("the 8pt spacing system", () => {
  test("every page spaces on the 4px grid, lines a card's content up and fades its scrollers", {
    tag: "@both",
  }, async ({ page }) => {
    test.setTimeout(120_000);
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect.soft(await offGrid(page), path).toEqual([]);
      expect.soft(await offCardEdge(page), `${path}: a card's edge`).toEqual([]);
      expect.soft(await unfadedScrollers(page), `${path}: a scroller's cut ends`).toEqual([]);
    }
  });

  test("open surfaces space on the 4px grid", { tag: "@both" }, async ({ page }) => {
    await page.route("**/api/site-icon**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
    );
    // The open player shows the playing story's transcript, which asks for its word marks; the
    // static server has no API, so answer as a turn with no marks does (the transcript estimates).
    await page.route("**/api/narrate-marks**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );

    // The full-screen player.
    await page.goto(AUDIO_DIGEST);
    await hydrated(page);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    // A Play opens the player over the page on a phone; from 1024px only the bar changes.
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await page.getByRole("button", { name: /^Player: / }).click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-player", "open");
    expect.soft(await offGrid(page), "the open player").toEqual([]);

    // A briefing's More actions menu.
    await page.goto(AUDIO_DIGEST);
    await hydrated(page);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.locator("#hero-menu").getByRole("menu")).toBeVisible();
    expect.soft(await offGrid(page), "the More actions menu").toEqual([]);

    // A Library row's More actions menu.
    await page.goto("/library");
    await hydrated(page);
    await openRowMenu(page, page.locator("[data-card]").first());
    await expect(page.getByRole("menu").first()).toBeVisible();
    expect.soft(await offGrid(page), "a Library row's menu").toEqual([]);

    // The Add source panel with the topic's suggested sources.
    await page.goto("/settings/categories/design");
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

test.describe("one page gutter", () => {
  // The Settings title once sat 24px further in than Latest's and Library's (a rule gave titles a
  // card's padding), so the page moved sideways between tabs. Compared page to page, never to a px.
  test("every top-level page starts and ends its content on the same edges", {
    tag: "@both",
  }, async ({ page }) => {
    test.setTimeout(120_000);
    // Latest's desktop hero is centred in its own layout, so it joins on the phone only.
    const width = page.viewportSize()?.width ?? 0;
    const wide = width >= 1024;
    // From 80rem the Library is as wide as the column and a contents list together, centred (D229), so
    // its title is not the column's.
    const paths = [
      ...(wide ? [] : ["/"]),
      ...(width >= 1280 ? [] : ["/library"]),
      "/settings",
      "/settings/preferences",
    ];
    const titles: number[] = [];
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      const found = await page.evaluate(() => {
        const title = document.querySelector("main h1");
        if (!title) throw new Error("no title");
        const range = document.createRange();
        range.selectNodeContents(title);
        const card = document.querySelector("main .card-group")?.getBoundingClientRect();
        const main = document.querySelector("main")?.getBoundingClientRect();
        return {
          title: range.getBoundingClientRect().left,
          card: card ? [card.left, card.right] : null,
          main: main ? [main.left, main.right] : null,
        };
      });
      titles.push(found.title);
      // A card is the page's content edge, left and right.
      if (path === "/settings") expect(found.card, `${path} renders a card group`).toBeTruthy();
      if (found.card) expect(found.card, `${path} card against its page`).toEqual(found.main);
    }
    for (const [index, title] of titles.entries()) {
      expect(title, `${paths[index]} title against ${paths[0]}`).toBeCloseTo(titles[0] ?? 0, 0);
    }
  });

  // The shell once reserved the contents list's track on every page, so a column on a wide window sat
  // left of the middle: 96px of room on its left and 384px on its right (owner, 2026-10-29). A page with
  // a contents list is centred as the column and its list together: the column alone beside its list sat
  // right of the middle (owner, 2026-11-01).
  test("a page's content has the same room on both sides of the pane", { tag: "@desktop" }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const widths: Record<string, number> = {};
    for (const path of ["/settings", "/d/2026-10-07", "/library", "/create"]) {
      await page.goto(path);
      await expect(page.locator("main h1, main .hero").first()).toBeVisible();
      const room = await page.evaluate(() => {
        const main = document.querySelector("main")?.getBoundingClientRect();
        const nav = document.querySelector(".app-nav")?.getBoundingClientRect();
        // The list's entries, where the page has one: the content reaches to their edge.
        const list = document.querySelector(".aside-link")?.getBoundingClientRect();
        if (!main || !nav) throw new Error("no main or navigation");
        // The body's edge, not the window's: a reserved scrollbar gutter is no room of the page's.
        return [
          main.left - nav.right,
          document.body.getBoundingClientRect().right - (list?.right ?? main.right),
          main.width,
        ];
      });
      expect(
        Math.abs((room[0] ?? 0) - (room[1] ?? 0)),
        `${path}: ${room.join(" against ")}`,
      ).toBeLessThan(2);
      widths[path] = room[2] ?? 0;
    }
    // The Library takes the width of a column and a contents list together, not the column's.
    expect(widths["/library"]).toBeGreaterThan((widths["/settings"] ?? 0) + 100);
  });
});

// Concentric corners (owner, 2026-11-01: a 28px popover around a 48px pill looked wrong, after the same
// complaint on 10-23 and 10-31). A rounded fill inside a rounded surface shares its corner's centre:
// the outer radius is the inner radius plus the gap between them (padding or margin, plus a border).
// Each surface is compared with its own fill, never with pinned radii, so a token that moves one
// without the other fails here.
const concentric = (outer: number, inner: number, gap: number) =>
  Math.abs(outer - (inner + gap)) <= 1.5;

test("a picker's pill is concentric with the list around it @both", async ({ page }) => {
  await page.goto("/settings/daily");
  await openPicker(page, page.locator("#daily-timezone"));
  const m = await pickerList(page).evaluate((pop) => {
    const pill = pop.querySelector(".picker-search") as HTMLElement;
    const popStyle = getComputedStyle(pop);
    const pillStyle = getComputedStyle(pill);
    return {
      outer: Number.parseFloat(popStyle.borderTopLeftRadius),
      inner: Number.parseFloat(pillStyle.borderTopLeftRadius),
      gap: Number.parseFloat(pillStyle.marginLeft) + Number.parseFloat(popStyle.borderLeftWidth),
    };
  });
  expect(concentric(m.outer, m.inner, m.gap), JSON.stringify(m)).toBe(true);
});

// Rows run edge to edge (owner, 2026-11-02): the list pads above and below only, so a row spans the
// list's full inner width and the list's own corner clips the first and last row. Each list is
// compared with its own rows, never with pinned numbers.
test("a Menu's and a select's rows span the list, with no gap at the sides @desktop", async ({
  page,
}) => {
  await page.goto("/library");
  const row = page.locator(`[data-card][data-id="${AUDIO_DIGEST.split("/").pop()}"]`);
  await openRowMenu(page, row);
  const menu = await row.locator(".menu-list").evaluate((list) => {
    const item = list.querySelector(".menu-item") as HTMLElement;
    const box = list.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    return { left: rect.left - box.left, right: box.right - rect.right };
  });
  expect(Math.abs(menu.left) + Math.abs(menu.right), JSON.stringify(menu)).toBeLessThanOrEqual(2);

  await page.goto("/settings/appearance");
  const select = page.locator("#settings-theme");
  await select.click();
  const list = await select.evaluate((element) => {
    const style = getComputedStyle(element, "::picker(select)");
    return {
      left: Number.parseFloat(style.paddingLeft),
      right: Number.parseFloat(style.paddingRight),
    };
  });
  expect(list.left + list.right, JSON.stringify(list)).toBe(0);
});

// Quick-action tiles only on a long menu (owner, 2026-11-04: a Downloads row's sheet of four showed two
// tiles over two rows). Every menu a page renders is held to the rule, so a new or edited menu that drifts
// fails here: tiles mean MENU_TILES_MIN actions or more and at most MENU_TILES_MAX of them; fewer actions mean no
// tiles. The queue row's sheet is React, drawn only with the player open, and shares the list (D369).
// shortcut: the constants are the app's own (lib/podcastActions.ts), until the Menu exports them (menu.ts).
test("a menu shows quick-action tiles only when it is long", async ({ page }) => {
  const drift: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    const menus = await page.evaluate(() =>
      [...document.querySelectorAll(".menu-list")].map((menu) => {
        const shown = (element: Element) => !element.closest("[hidden]");
        const actions = [...menu.querySelectorAll(".menu-item, .menu-tile")].filter(shown);
        const tiles = [...menu.querySelectorAll(".menu-tiles")]
          .filter(shown)
          .flatMap((row) => [...row.children].filter(shown));
        return { id: menu.id || menu.className, actions: actions.length, tiles: tiles.length };
      }),
    );
    for (const menu of menus) {
      const long = menuHasTiles(menu.actions);
      if (menu.tiles > MENU_TILES_MAX || menu.tiles > 0 !== long) {
        drift.push(`${path} ${menu.id}: ${menu.actions} actions, ${menu.tiles} tiles`);
      }
    }
  }
  expect(drift).toEqual([]);
});

// A pressed control keeps its label (owner, 2026-11-02: a tap on the navigation's segmented control hid
// its text). A state fill is opaque since D317, so a press layer drawn above the label covers it where
// the old alpha layer let it show through. The check is what a person sees, not a rule: each kind of
// control on a page is held in its pressed and hovered state, drawn once as it is and once with its text
// and glyph made transparent; when the two pictures match, nothing of the label was painted.
test("a pressed or hovered control still shows its label @both", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const hidden: string[] = [];
  for (const path of ["/settings/preferences", "/library", "/settings", "/create", AUDIO_DIGEST]) {
    await page.goto(path);
    await hydrated(page);
    const kinds = await page.evaluate(() => {
      const seen = new Set<string>();
      const found: { index: number; kind: string }[] = [];
      const all = document.querySelectorAll<HTMLElement>(
        'button, a[href], [role="tab"], [role="menuitem"], summary',
      );
      for (const element of all) {
        const box = element.getBoundingClientRect();
        const painted = element.textContent?.trim() || element.querySelector("svg");
        const kind = `${element.tagName}.${element.className}[${element.getAttribute("role")}]`;
        const onScreen = box.right > 0 && box.left < innerWidth && box.bottom + scrollY > 0;
        if (box.width < 8 || box.height < 8 || !onScreen || !painted || seen.has(kind)) continue;
        if (element.matches(':disabled, [aria-disabled="true"], [hidden]')) continue;
        // The avatar is a picture drawn from tokens, not a label in the text colour.
        if (element.querySelector(".avatar")) continue;
        if (getComputedStyle(element).visibility !== "visible") continue;
        seen.add(kind);
        element.dataset.pressProbe = String(found.length);
        found.push({ index: found.length, kind });
      }
      return found;
    });
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    for (const { index, kind } of kinds) {
      const target = page.locator(`[data-press-probe="${index}"]`);
      if (!(await target.isVisible())) continue;
      await target.scrollIntoViewIfNeeded();
      // A control under a fixed bar or toast is not what a person presses; skip it.
      const covered = await target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !top || !element.contains(top);
      });
      if (covered) continue;
      // The pointer is over the control and the parts around it (a card shows its More button on
      // hover), and the press is on the control.
      await target.evaluate((element) => {
        for (let node = element.parentElement; node && node !== document.body; ) {
          node.setAttribute("data-press-chain", "");
          node = node.parentElement;
        }
      });
      const chain = await cdp.send("DOM.querySelectorAll", {
        nodeId: root.nodeId,
        selector: "[data-press-chain]",
      });
      for (const id of chain.nodeIds) {
        await cdp.send("CSS.forcePseudoState", { nodeId: id, forcedPseudoClasses: ["hover"] });
      }
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: `[data-press-probe="${index}"]`,
      });
      await cdp.send("CSS.forcePseudoState", {
        nodeId,
        forcedPseudoClasses: ["hover", "active"],
      });
      const shown = await target.screenshot({ animations: "disabled" });
      // Set through the CSSOM: the page's policy refuses an injected style element.
      const clear = (on: boolean) =>
        target.evaluate((element, on) => {
          for (const node of [element, ...element.querySelectorAll<HTMLElement>("*")]) {
            for (const property of ["color", "-webkit-text-fill-color"]) {
              if (on) (node as HTMLElement).style.setProperty(property, "transparent", "important");
              else (node as HTMLElement).style.removeProperty(property);
            }
          }
        }, on);
      await clear(true);
      const bare = await target.screenshot({ animations: "disabled" });
      await clear(false);
      await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
      for (const id of chain.nodeIds) {
        await cdp.send("CSS.forcePseudoState", { nodeId: id, forcedPseudoClasses: [] });
      }
      await page.evaluate(() => {
        for (const node of document.querySelectorAll("[data-press-chain]")) {
          node.removeAttribute("data-press-chain");
        }
      });
      const differing = await page.evaluate(
        async ([a, b]) => {
          const draw = async (base64: string) => {
            const bitmap = await createImageBitmap(
              new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]),
            );
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
            context.drawImage(bitmap, 0, 0);
            return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
          };
          const [one, two] = [await draw(a as string), await draw(b as string)];
          let count = 0;
          for (let i = 0; i < one.length; i += 4) {
            if (Math.abs((one[i] ?? 0) - (two[i] ?? 0)) > 24) count += 1;
          }
          return count;
        },
        [shown.toString("base64"), bare.toString("base64")],
      );
      if (differing < 12) hidden.push(`${path} ${kind}`);
    }
  }
  expect(hidden, "controls whose label is not painted while pressed").toEqual([]);
});

// A one-row card took the 32px card radius and read as a pill (owner, 2026-10-27). Each card is
// compared to its own height, never to a pinned radius: short of the pill's half.
test("no settings card's corner reaches 40% of its height", {
  tag: "@both",
}, async ({ page }) => {
  for (const path of ["/settings", "/settings/preferences", "/settings/daily"]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    const over = await page.$$eval("main :is(.card-group, .topic-panel)", (cards) =>
      cards.flatMap((card) => {
        const height = card.getBoundingClientRect().height;
        const radius = Number.parseFloat(getComputedStyle(card).borderTopLeftRadius);
        return height > 0 && radius >= height * 0.4
          ? [`${card.className}: ${radius}/${height}`]
          : [];
      }),
    );
    expect(over, path).toEqual([]);
  }
});

// Expressive's big corner took the half-heard bar's ends outside the art (owner, 2026-11-03: "the play
// progress gets out of the bounding box of library album art"). The bar is held to its cover's own
// rounded box in every mood and both views, never to a pinned inset.
test("a half-heard bar stays inside its cover's rounded corners in every mood", {
  tag: "@both",
}, async ({ page }) => {
  const outside: string[] = [];
  for (const mood of ["default", "expressive", "halloween"]) {
    for (const view of ["list", "gallery"]) {
      await page.goto("/library");
      await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");
      await page.evaluate((m) => {
        const root = document.documentElement.dataset;
        if (m === "default") delete root.mood;
        else root.mood = m;
      }, mood);
      await page.locator(`.view-btn[data-library-view='${view}']`).click();
      await expect(page.locator("[data-library]")).toHaveAttribute("data-view", view);
      const found = await page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>(".card-progress");
        const cover = bar?.closest(".card-link")?.querySelector<HTMLElement>(".cover");
        if (!bar || !cover) return null;
        bar.hidden = false;
        bar.style.setProperty("--progress", "100%");
        const b = bar.getBoundingClientRect();
        const c = cover.getBoundingClientRect();
        // The corner is min(the mood's radius, 25%): the computed value keeps both terms.
        const terms = getComputedStyle(cover).borderTopLeftRadius.match(/[\d.]+(px|%)/g) ?? [];
        const r = Math.min(
          ...terms.map((t) =>
            t.endsWith("%") ? (Number.parseFloat(t) * c.width) / 100 : Number.parseFloat(t),
          ),
        );
        const points: [number, number][] = [
          [b.left, b.top],
          [b.right, b.top],
          [b.left, b.bottom],
          [b.right, b.bottom],
        ];
        // How far a point lies beyond the rounded corner it is nearest, 0 when it is inside.
        const beyond = points.map(([x, y]) => {
          const dx = Math.min(x - c.left, c.right - x);
          const dy = Math.min(y - c.top, c.bottom - y);
          if (dx < 0 || dy < 0) return Math.max(-dx, -dy, 0) + 1;
          if (dx >= r || dy >= r) return 0;
          return Math.max(0, Math.hypot(r - dx, r - dy) - r);
        });
        return { radius: Math.round(r), worst: Math.max(...beyond) };
      });
      expect(found, `${mood} ${view}: a library card with a progress bar`).not.toBeNull();
      // A round end's corner is not painted: a pixel of slack covers it.
      if (found && found.worst > 1)
        outside.push(
          `${mood} ${view}: ${found.worst.toFixed(1)}px beyond a ${found.radius}px corner`,
        );
    }
  }
  expect(outside).toEqual([]);
});

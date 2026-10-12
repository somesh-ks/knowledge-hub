import { expect, test } from "./helpers";

/**
 * The expanded player at sizes people really get: a small phone with Safari's toolbars showing, a
 * phone on its side, a short laptop window. Nothing may be squeezed under anything else, and
 * everything must be reachable.
 */
const SIZES = [
  { width: 375, height: 553, tag: "" },
  { width: 390, height: 664, tag: "" },
  { width: 844, height: 390, tag: "" },
  // A laptop window, with a mouse: these run on the desktop project only.
  { width: 1280, height: 620, tag: " @wide" },
  { width: 1280, height: 800, tag: " @wide" },
] as const;

interface LayoutReport {
  problems: string[];
  parts: Record<string, string>;
}

/** Runs in the page: measures the parts every size must show whole. */
const LAYOUT_CHECK = (): LayoutReport => {
  const problems: string[] = [];
  const dialog = document.querySelector<HTMLElement>(
    '[data-player-surface][role="dialog"] [data-player-page]',
  );
  if (!dialog) return { problems: ["the player is not open"], parts: {} };
  const parts: Record<string, HTMLElement | null> = {
    cover: dialog.querySelector<HTMLElement>(".player-cover-frame"),
    title: dialog.querySelector<HTMLElement>(".player-title"),
    transport: dialog.querySelector<HTMLElement>(".transport"),
  };
  // One timeline: on a wide screen with a mouse it is the bar's and the page has none, so the page's
  // scrubber is measured only where it is drawn. The bar's must then be there instead.
  const pageSlider = dialog.querySelector<HTMLElement>('[role="slider"]');
  if (pageSlider && pageSlider.getBoundingClientRect().width > 0) {
    parts.scrubber = pageSlider;
  } else if (!((document.querySelector(".dock-seek")?.getBoundingClientRect().width ?? 0) > 0)) {
    problems.push("no timeline is shown, on the page or on the bar");
  }
  const scroller = (element: HTMLElement): HTMLElement => {
    for (let node: HTMLElement | null = element; node && node !== document.body; ) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && dialog.contains(node)) return node;
      node = node.parentElement;
    }
    return dialog;
  };
  for (const node of new Set(
    Object.values(parts).map((part) => (part ? scroller(part) : dialog)),
  )) {
    node.scrollTop = 0;
  }
  const frame = dialog.getBoundingClientRect();
  const extent = Math.max(dialog.scrollHeight, dialog.clientHeight);
  const rects: Record<string, DOMRect> = {};
  const summary: Record<string, string> = {};
  for (const [name, part] of Object.entries(parts)) {
    if (!part) {
      problems.push(`${name} is missing`);
      continue;
    }
    const rect = part.getBoundingClientRect();
    rects[name] = rect;
    summary[name] =
      `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (rect.width < 1 || rect.height < 1) problems.push(`${name} has no size`);
    const inside =
      rect.left >= frame.left - 0.5 &&
      rect.right <= frame.right + 0.5 &&
      rect.top >= frame.top - 0.5 &&
      rect.bottom <= frame.top + extent + 0.5;
    if (!inside) problems.push(`${name} is outside the surface`);
  }
  const names = Object.keys(rects);
  for (let a = 0; a < names.length; a += 1) {
    for (let b = a + 1; b < names.length; b += 1) {
      const first = rects[names[a] ?? ""];
      const second = rects[names[b] ?? ""];
      if (!first || !second) continue;
      const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
      if (overlapX > 0.5 && overlapY > 0.5) {
        problems.push(`${names[a]} overlaps ${names[b]} by ${Math.round(overlapY)}px`);
      }
    }
  }
  // Reachable: each part can be brought fully on screen, with nothing lying over its center.
  for (const [name, part] of Object.entries(parts)) {
    if (!part) continue;
    part.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = part.getBoundingClientRect();
    const fits = rect.height <= window.innerHeight;
    if (fits && (rect.top < -0.5 || rect.bottom > window.innerHeight + 0.5)) {
      problems.push(`${name} cannot be scrolled fully into view`);
    }
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || !(part.contains(hit) || hit.contains(part))) {
      problems.push(`${name} is covered at its center`);
    }
  }
  return { problems, parts: summary };
};

test.describe("layout at real window sizes", () => {
  for (const size of SIZES) {
    test(`at ${size.width}x${size.height} nothing overlaps and everything can be reached${size.tag}`, async ({
      player,
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await player.open();
      await player.play();
      await player.openPlayer();
      await expect(player.scrubber).toBeVisible();
      // One timeline, never two: the bar's, or the page's where the bar has none.
      await expect(page.getByRole("slider", { name: /^(Playback position|Seek)$/ })).toHaveCount(1);
      const report = await page.evaluate(LAYOUT_CHECK);
      expect(report.problems, JSON.stringify(report.parts)).toEqual([]);
      // The last control and the last row of the list can both be reached.
      const last = player.dialog.getByRole("button").last();
      await last.scrollIntoViewIfNeeded();
      // Not 1: a minimal scroll lands on a whole pixel while the row sits on a fraction of one, so
      // a quarter of a pixel of a fully reachable row can fall outside the clip.
      await expect(last).toBeInViewport({ ratio: 0.99 });
      // And it stays there: the list must not shift when the story being read changes.
      const before = await last.boundingBox();
      const story = page.locator("[data-item-id][data-state='current']");
      const reading = await story.getAttribute("data-item-id");
      await expect(story).not.toHaveAttribute("data-item-id", reading ?? "");
      const after = await last.boundingBox();
      // A fraction of a pixel is the scroll settling; a re-wrapped title moved rows by six.
      expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
    });
  }
});

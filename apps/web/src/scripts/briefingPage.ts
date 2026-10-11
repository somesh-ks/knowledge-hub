/**
 * What a briefing page does on its own, without the player: it marks the section in view on the
 * section tabs and the contents list, and it shares the briefing's address. Loaded by the briefing
 * view. A bundled module runs once per session, so the per-page work listens for astro:page-load.
 */
import { installHeroMenu } from "./heroMenu";

installHeroMenu();

const COPIED_MS = 2_000;
const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

let observer: IntersectionObserver | null = null;
let endObserver: IntersectionObserver | null = null;
let stuckObserver: IntersectionObserver | null = null;
/** A tapped tab stays marked until the reader scrolls, even where its section cannot reach the top. */
let held = false;

function mark(slug: string | undefined): void {
  if (!slug) return;
  for (const link of document.querySelectorAll<HTMLElement>("a[data-section]")) {
    const isCurrent = link.dataset.section === slug;
    if (isCurrent === (link.getAttribute("aria-current") === "true")) continue;
    if (isCurrent) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
    const strip = link.closest<HTMLElement>("[data-section-tabs]");
    if (isCurrent && strip) revealTab(strip, link);
  }
}

/**
 * Scrolls the strip only when a tab is cut off at one of its edges, and then by the least amount
 * that shows the whole tab and the strip's padding beside it, which puts its label back on the
 * page's gutter. Cut off means its label and underline, inside its padding, or its focus ring,
 * drawn inside the tab nearer its edges (primitives.css), do not all show: where every label fits
 * the strip never moves. Moves the strip itself: scrollIntoView would also scroll the page when
 * the strip is off screen.
 */
function revealTab(
  strip: HTMLElement,
  tab: HTMLElement,
  behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth",
): void {
  const view = strip.getBoundingClientRect();
  const box = tab.getBoundingClientRect();
  const end = view.left + strip.clientWidth;
  const look = getComputedStyle(tab);
  const inset =
    (tab.matches(":focus-visible")
      ? -Number.parseFloat(look.outlineOffset) - Number.parseFloat(look.outlineWidth)
      : Number.parseFloat(look.paddingInlineStart)) || 0;
  // Half a pixel either way is rounding, not a tab that is cut off.
  if (box.left + inset >= view.left - 0.5 && box.right - inset <= end + 0.5) return;
  const room = getComputedStyle(strip);
  const before = box.left - Number.parseFloat(room.paddingInlineStart) - view.left;
  const after = box.right + Number.parseFloat(room.paddingInlineEnd) - end;
  strip.scrollBy({ left: before < 0 ? before : Math.max(after, 0), behavior });
}

/**
 * While the strip is stuck under the app bar it draws the one line under the top chrome, and the
 * bar's own line goes (briefing.css). Stuck, the strip sits a pixel above the bar's bottom edge; it
 * stays above it while the end of the briefing pushes it under the bar, until it is gone. Chromium
 * reports a strip partly past that edge as not intersecting, so the test reads its top instead.
 */
function watchStuck(strip: HTMLElement): void {
  const edge = stickyTop();
  stuckObserver = new IntersectionObserver(
    ([entry]) => {
      if (!entry) return;
      const top = entry.rootBounds?.top ?? edge;
      strip.toggleAttribute(
        "data-stuck",
        entry.intersectionRatio > 0 && entry.boundingClientRect.top < top,
      );
    },
    { rootMargin: `-${Math.round(edge)}px 0px 0px 0px`, threshold: [0, 1] },
  );
  stuckObserver.observe(strip);
}

/**
 * Where what sticks under the top chrome sticks now, in pixels: `--sticky-top`, resolved. Below 64rem
 * the app bar slides away on a scroll down and `--sticky-top` follows it (shell.css), and the strip's
 * own `top` eases between the two, so reading the strip mid-move would give a value in between. A
 * fixed probe with no transition resolves the end value at once.
 */
function stickyTop(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:var(--sticky-top);height:0;visibility:hidden";
  document.body.append(probe);
  const top = probe.getBoundingClientRect().top;
  probe.remove();
  return top;
}

/**
 * Below 64rem the floating Play button (PlayFab.astro) waits while the hero's own Play is on screen:
 * the root carries data-hero-away once that chip has scrolled out of view (create-sheet.css).
 */
let heroObserver: IntersectionObserver | null = null;

function watchHeroPlay(): void {
  heroObserver?.disconnect();
  const root = document.documentElement;
  const actions = document.querySelector<HTMLElement>(".hero .hero-actions");
  if (!actions) {
    root.removeAttribute("data-hero-away");
    return;
  }
  heroObserver = new IntersectionObserver(([entry]) => {
    if (entry) root.toggleAttribute("data-hero-away", !entry.isIntersecting);
  });
  heroObserver.observe(actions);
}

function watchSections({ keepHeld = false } = {}): void {
  observer?.disconnect();
  endObserver?.disconnect();
  stuckObserver?.disconnect();
  if (!keepHeld) held = false;
  const sections = [...document.querySelectorAll<HTMLElement>("[data-chapter]")];
  const first = sections[0];
  const last = sections.at(-1);
  if (!first || !last) return;
  // An empty element after everything else on the page (DigestView.astro).
  const end = document.querySelector<HTMLElement>("[data-page-end]");
  const strip = document.querySelector<HTMLElement>("[data-section-tabs]");
  // The reading line: a heading's padding under the sticky strip (or the top, where the strip is
  // not shown), which is where a jump to a section puts its heading's words. A jump made while the
  // app bar shows can leave the heading lower once the bar slides away, still within this line.
  const chrome = strip?.offsetParent ? stickyTop() + strip.offsetHeight : 0;
  if (strip?.offsetParent) watchStuck(strip);
  const inView = new Set<Element>();
  /** All on screen: the first section, the end of the page, or both. */
  const whole = new Set<Element>();
  const follow = (): void => {
    if (held) return;
    // At the end of the page the last section is marked, since a short one never reaches the
    // reading line, unless the first section is all on screen too: then the page fits the screen.
    // Otherwise the mark goes to the topmost section crossing the band between the line and
    // mid-screen. None means the reader is above the first or past the last: above the first (an
    // instant jump to the top, where the first section starts below mid-screen) marks the first,
    // and past the last keeps the mark where it was.
    const atEnd = end !== null && whole.has(end) && !whole.has(first);
    const current = atEnd
      ? last
      : (sections.find((section) => inView.has(section)) ??
        (first.getBoundingClientRect().top > chrome ? first : undefined));
    if (current) mark(current.dataset.chapter);
  };
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target);
        else inView.delete(entry.target);
      }
      follow();
    },
    { rootMargin: `-${Math.round(chrome) + 48}px 0px -50% 0px` },
  );
  // The end element has no height, so it counts as all on screen whenever it is on screen at all.
  endObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 1) whole.add(entry.target);
        else whole.delete(entry.target);
      }
      follow();
    },
    { threshold: 1 },
  );
  for (const section of sections) observer.observe(section);
  endObserver.observe(first);
  if (end) endObserver.observe(end);
}

async function share(button: HTMLElement): Promise<void> {
  const url = new URL(button.dataset.share ?? "", location.href).href;
  if (navigator.share) {
    try {
      await navigator.share({ title: document.title, url });
      return;
    } catch (error) {
      // The reader closed the share sheet: nothing more to do. Any other failure falls back to a copy.
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // The clipboard is not available here (an insecure origin, a denied permission).
    return;
  }
  // The menu closes on a pick, so the confirmation shows on its More button, and is spoken.
  const host = button.closest("[data-share-host]");
  const status = host?.querySelector("[data-share-status]");
  const mark = host?.querySelector<HTMLElement>("[data-hero-more]") ?? button;
  const name = mark.getAttribute("aria-label") ?? "";
  mark.setAttribute("data-copied", "");
  mark.setAttribute("aria-label", "Link copied");
  if (status) status.textContent = "Link copied";
  document.dispatchEvent(new CustomEvent("dispatch:sound", { detail: "success" }));
  setTimeout(() => {
    mark.removeAttribute("data-copied");
    mark.setAttribute("aria-label", name);
    if (status) status.textContent = "";
  }, COPIED_MS);
}

// A tab reached with the keyboard can sit cut off at the strip's edge: bring it into the strip, at
// once, since what a key starts is never animated. A card on the Earlier briefings shelf can sit flush
// with the shelf's edge, its ring cut off, which the browser counts as in view: bring it in by the
// shelf's scroll padding.
document.addEventListener("focusin", (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  const strip = event.target.closest<HTMLElement>("[data-section-tabs]");
  if (strip && event.target.matches("a.tab"))
    revealTab(strip, event.target, event.target.matches(":focus-visible") ? "instant" : undefined);
  else if (event.target.matches(".shelf a.card-link"))
    event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const tab = event.target.closest<HTMLElement>("a[data-section]");
  if (tab) {
    held = true;
    mark(tab.dataset.section);
    return;
  }
  const button = event.target.closest<HTMLElement>("[data-share]");
  if (button && !button.closest("[data-share-host]")?.querySelector("[data-copied]"))
    void share(button);
});

const release = (): void => {
  held = false;
};
window.addEventListener("wheel", release, { passive: true });
window.addEventListener("touchmove", release, { passive: true });
window.addEventListener("keydown", release);
// Back and Forward move the page to an address of their own, so the mark follows the scroll again.
window.addEventListener("popstate", release);

/**
 * From 80rem the contents list starts level with the first section's heading: its title's words on
 * the heading's first line (aside.css reads --aside-start). Measured, since the header above the
 * heading grows with the title and the window.
 */
function placeAside(): void {
  const aside = document.querySelector<HTMLElement>(".aside");
  const main = document.querySelector<HTMLElement>("main");
  const heading = document.querySelector<HTMLElement>("[data-chapter] > h2");
  const title = aside?.querySelector<HTMLElement>(".aside-title");
  if (!aside || !main || !heading || !title || !aside.offsetParent) return;
  const words = (node: HTMLElement): number => {
    const look = getComputedStyle(node);
    const leading = Number.parseFloat(look.lineHeight) - Number.parseFloat(look.fontSize);
    return Number.parseFloat(look.paddingTop) + (Number.isNaN(leading) ? 0 : leading / 2);
  };
  const top =
    heading.getBoundingClientRect().top - main.getBoundingClientRect().top + words(heading);
  // The list's own padding and its title's half-leading sit above the title's words.
  const offset = Number.parseFloat(getComputedStyle(aside).paddingTop) + words(title);
  aside.style.setProperty("--aside-start", `${Math.max(Math.round(top - offset), 0)}px`);
}

/** Marks a tab strip whose tabs all fit, which then shows no edge fades (briefing.css). */
function fitStrip(): void {
  const strip = document.querySelector<HTMLElement>("[data-section-tabs]");
  strip?.toggleAttribute("data-fits", strip.scrollWidth <= strip.clientWidth + 1);
}

const measure = (): void => {
  placeAside();
  fitStrip();
};

const watchPage = (): void => {
  watchSections();
  watchHeroPlay();
  measure();
  void document.fonts?.ready.then(measure);
};

window.addEventListener("resize", () => requestAnimationFrame(measure), { passive: true });

// The app bar hiding or coming back moves the strip, and with it the reading line and the edge it
// sticks at: measure again from where they now are. A tapped tab keeps its mark through the move.
new MutationObserver(() => {
  if (document.querySelector("[data-section-tabs]")) watchSections({ keepHeld: true });
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-bar-hidden"] });

document.addEventListener("astro:page-load", watchPage);
watchPage();

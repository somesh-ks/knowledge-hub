/**
 * What a briefing page does on its own, without the player: it marks the section in view on the
 * section tabs and the contents list, and it shares the briefing's address. Loaded by the briefing
 * view. A bundled module runs once per session, so the per-page work listens for astro:page-load.
 */
import { installHeroMenu } from "./heroMenu";
import { warmWhenIdle } from "./idle";
import { prepareEarly, shareItem, shareLink } from "./shareLink";
import { sendToast } from "./toastEvent";

installHeroMenu();

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

let observer: IntersectionObserver | null = null;
let endObserver: IntersectionObserver | null = null;
let stuckObserver: IntersectionObserver | null = null;
/** A tapped tab stays marked until the reader scrolls, even where its section cannot reach the top. */
let held = false;
/**
 * Where the page stood once the tapped tab's jump had landed. Any later scroll away from it hands the
 * mark back: the scrollbar, a find, and the player following its story scroll without a wheel or a
 * touch.
 */
let heldAt: number | null = null;
/** More than this is a scroll of someone's making, not the page settling. */
const HELD_SLACK = 8;
/** Marks the section in view, once a held mark has been handed back (set by watchSections). */
let refollow: (() => void) | null = null;

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
function watchStuck(bar: HTMLElement, edge: number): void {
  stuckObserver = new IntersectionObserver(
    ([entry]) => {
      if (!entry) return;
      const top = entry.rootBounds?.top ?? edge;
      const stuck = entry.intersectionRatio > 0 && entry.boundingClientRect.top < top;
      bar.toggleAttribute("data-stuck", stuck);
      // The app bar reads it from the root, which restyles only the bar, not the whole page (D147).
      document.documentElement.toggleAttribute("data-tabs-stuck", stuck);
    },
    { rootMargin: `-${Math.round(edge)}px 0px 0px 0px`, threshold: [0, 1] },
  );
  stuckObserver.observe(bar);
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
  // The bar around the strip is what sticks (Briefing.astro). Here every box is read before the probe
  // in stickyTop goes in, and the probe is read once: each read after a change to the page restyles
  // all of it, about 60 ms on a throttled phone.
  const bar = strip?.closest<HTMLElement>("[data-tabs-bar]") ?? strip;
  const stripHeight = strip?.offsetParent ? strip.offsetHeight : null;
  const barShown = Boolean(bar?.offsetParent);
  const edge = stripHeight !== null || barShown ? stickyTop() : 0;
  const chrome = stripHeight !== null ? edge + stripHeight : 0;
  if (bar && barShown) watchStuck(bar, edge);
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
  refollow = follow;
  // A thin band a third of the way down the space under the sticky chrome: the section whose title
  // has just come up to it is the one marked, so the rail answers as a heading enters the reading
  // area, not once the section before it has left (2026-10-25: it lit well after the title arrived).
  const line = Math.round(chrome + (innerHeight - chrome) * 0.33);
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target);
        else inView.delete(entry.target);
      }
      follow();
    },
    { rootMargin: `-${line}px 0px -${Math.max(0, innerHeight - line - 2)}px 0px` },
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
  const { shareItem: id, shareKind, shareOf } = button.dataset;
  // Empty on a shared page: it sends on the link it was opened at.
  const path = button.dataset.share || location.pathname;
  const kind = shareKind === "episode" ? "episode" : "briefing";
  // A shared page sends its own link on, counted by the item it plays (data-share-of), never the token.
  const outcome = id
    ? await shareItem({ id, title: document.title, path, kind })
    : await shareLink(document.title, path, shareOf ? { kind, item: shareOf } : undefined);
  // A link that was made opens the share dialog, which says its own copy (shareDialog.ts).
  if (typeof outcome === "object") sendToast({ message: outcome.refused });
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

// A tab's jump lands its heading below the sticky chrome as it stands when the browser jumps, and a
// jump down sends the app bar away, which pulls the strip up after the heading has landed: the heading
// would end a bar's height too low. So the header hears of the jump first and holds the bar as the
// jump will leave it (SiteHeader.astro). Capture phase: Astro's router starts the jump in the bubble
// phase, ahead of any listener below it.
document.addEventListener(
  "click",
  (event) => {
    if (!(event.target instanceof Element) || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const tab = event.target.closest<HTMLElement>("a[data-section]");
    const heading = tab && document.getElementById(`c-${tab.dataset.section}`);
    if (!heading) return;
    const down = heading.getBoundingClientRect().top > stickyTop();
    document.dispatchEvent(new CustomEvent("singularity:jump", { detail: { down } }));
  },
  { capture: true },
);

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const tab = event.target.closest<HTMLElement>("a[data-section]");
  if (tab) {
    held = true;
    heldAt = null;
    // The jump is instant: two frames on, the page is where it will stay.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (held) heldAt = scrollY;
      }),
    );
    mark(tab.dataset.section);
    return;
  }
  const button = event.target.closest<HTMLElement>("[data-share]");
  if (button) void share(button);
});

const release = (): void => {
  held = false;
  heldAt = null;
};
window.addEventListener(
  "scroll",
  () => {
    if (!held || heldAt === null || Math.abs(scrollY - heldAt) <= HELD_SLACK) return;
    release();
    // The sections in view were tracked all along; only the mark was kept back.
    refollow?.();
  },
  { passive: true },
);
window.addEventListener("wheel", release, { passive: true });
window.addEventListener("touchmove", release, { passive: true });
window.addEventListener("keydown", release);
// Back and Forward move the page to an address of their own, so the mark follows the scroll again.
window.addEventListener("popstate", release);

/** Marks a tab strip whose tabs all fit, which then shows no edge fades (briefing.css). */
function fitStrip(): () => void {
  const strip = document.querySelector<HTMLElement>("[data-section-tabs]");
  const fits = strip ? strip.scrollWidth <= strip.clientWidth + 1 : false;
  return () => strip?.toggleAttribute("data-fits", fits);
}

const measure = (): void => {
  fitStrip()();
};

const watchPage = (): void => {
  // Read before watchSections and written after it: a read after a change to the page costs another
  // restyle of all of it.
  const fit = fitStrip();
  watchSections();
  watchHeroPlay();
  prepareEarly();
  fit();
  void document.fonts?.ready.then(measure);
};

window.addEventListener("resize", () => requestAnimationFrame(measure), { passive: true });

// The app bar hiding or coming back moves the strip, and with it the reading line and the edge it
// sticks at: measure again from where they now are. A tapped tab keeps its mark through the move.
new MutationObserver(() => {
  if (document.querySelector("[data-section-tabs]")) watchSections({ keepHeld: true });
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-bar-hidden"] });

/**
 * The More menu's Download and Add to queue (HeroMenu.astro) are the Library row's, wired by
 * libraryMenu.ts; its code loads at idle, not with the page. Offline the idle load is skipped and
 * an early press can beat it, so the first touch of the menu loads it too (it installs once).
 */
function wirePageMenu(): void {
  const menu = document.querySelector("[data-page-menu]");
  if (!menu) return;
  const install = (): Promise<void> =>
    import("./libraryMenu").then((module) => module.installLibraryMenu());
  warmWhenIdle(install);
  // A failed load (offline, chunk not cached) leaves the listeners armed, so the next touch tries again.
  const types = ["pointerdown", "focusin"];
  const touch = (): void => {
    void install().then(
      () => {
        for (const type of types) menu.removeEventListener(type, touch);
      },
      () => undefined,
    );
  };
  for (const type of types) menu.addEventListener(type, touch);
}

document.addEventListener("astro:page-load", watchPage);
document.addEventListener("astro:page-load", wirePageMenu);
watchPage();
wirePageMenu();

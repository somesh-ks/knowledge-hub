/**
 * What a briefing page does on its own, without the player: it marks the section in view on the
 * section tabs and the contents list, and it shares the briefing's address. Loaded by the briefing
 * view. A bundled module runs once per session, so the per-page work listens for astro:page-load.
 */
import { installHeroMenu } from "./heroMenu";

installHeroMenu();

const COPIED_MS = 2_000;

let observer: IntersectionObserver | null = null;
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
    if (!isCurrent || !strip) continue;
    // Moves the strip itself. scrollIntoView would also scroll the page when the strip is off screen.
    strip.scrollTo({
      left: link.offsetLeft - (strip.clientWidth - link.offsetWidth) / 2,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
}

function watchSections(): void {
  observer?.disconnect();
  held = false;
  const sections = [...document.querySelectorAll<HTMLElement>("[data-chapter]")];
  if (sections.length === 0) return;
  const strip = document.querySelector<HTMLElement>("[data-section-tabs]");
  // The reading line: just under the sticky strip, or near the top where the strip is not shown.
  const chrome = strip?.offsetParent
    ? (Number.parseFloat(getComputedStyle(strip).top) || 0) + strip.offsetHeight
    : 0;
  const inView = new Set<Element>();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target);
        else inView.delete(entry.target);
      }
      // The topmost section crossing the band between the line and mid-screen. None means the
      // reader is above the first or past the last, and the mark stays where it was.
      const top = sections.find((section) => inView.has(section));
      if (top && !held) mark(top.dataset.chapter);
    },
    { rootMargin: `-${Math.round(chrome) + 24}px 0px -50% 0px` },
  );
  for (const section of sections) observer.observe(section);
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
  setTimeout(() => {
    mark.removeAttribute("data-copied");
    mark.setAttribute("aria-label", name);
    if (status) status.textContent = "";
  }, COPIED_MS);
}

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

document.addEventListener("astro:page-load", watchSections);
watchSections();

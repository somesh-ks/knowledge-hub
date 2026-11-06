/**
 * Marks the section in view in a page's section tabs (phone and tablet) and its contents list (from
 * 80rem): the last section whose top has passed the sticky chrome. The links are plain anchors, so
 * they work without this; it only moves the mark, and keeps the marked tab in its strip's view.
 * The reader's briefingPage.ts does the same for a briefing, tied to its own markup.
 */

const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-section]")];
const sections = [...new Set(links.map((link) => link.dataset.section ?? ""))]
  .map((slug) => document.getElementById(`c-${slug}`))
  .filter((section): section is HTMLElement => section !== null);

let current = "";

function mark(slug: string): void {
  if (slug === current) return;
  current = slug;
  for (const link of links) {
    const on = link.dataset.section === slug;
    if (on) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
    const strip = link.closest<HTMLElement>("[data-section-tabs]");
    if (on && strip && strip.offsetParent !== null) {
      const left = link.offsetLeft - (strip.clientWidth - link.offsetWidth) / 2;
      strip.scrollTo({ left, behavior: "smooth" });
    }
  }
}

function inView(): void {
  const top = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  // A step past the sticky chrome, so a section is marked once its heading is under it.
  const line = top + 24;
  const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  const passed = sections.filter((section) => section.getBoundingClientRect().top <= line);
  const last = atEnd ? sections.at(-1) : passed.at(-1);
  mark((last ?? sections[0])?.id.slice(2) ?? "");
}

if (sections.length > 1) {
  let queued = false;
  addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        inView();
      });
    },
    { passive: true },
  );
  addEventListener("resize", inView, { passive: true });
  inView();
}

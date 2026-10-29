/**
 * A page's filter: typing narrows every [data-filter-item] to those whose name or text holds each
 * word, and a section left with none steps aside. The query is not kept; the page is small enough to
 * start again from the top.
 */
export {};

const field = document.querySelector<HTMLInputElement>("[data-filter]");
const items = Array.from(document.querySelectorAll<HTMLElement>("[data-filter-item]"));
const empty = document.querySelector<HTMLElement>("[data-filter-empty]");

function apply(): void {
  const terms = (field?.value ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const item of items) {
    const text = `${item.dataset.name ?? ""} ${item.textContent ?? ""}`.toLowerCase();
    item.hidden = !terms.every((term) => text.includes(term));
    if (!item.hidden) shown++;
  }
  for (const section of document.querySelectorAll<HTMLElement>(".guide-page section")) {
    const own = section.querySelectorAll("[data-filter-item]");
    section.hidden =
      terms.length > 0 &&
      own.length > 0 &&
      !section.querySelector("[data-filter-item]:not([hidden])");
  }
  // A jump link to a section that stepped aside would lead nowhere: it steps aside too.
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const target = document.getElementById(link.hash.slice(1))?.closest("section");
    if (target) link.hidden = target.hidden;
  }
  if (empty) empty.hidden = terms.length === 0 || shown > 0;
}

field?.addEventListener("input", apply);
addEventListener("keydown", (event) => {
  const active = document.activeElement;
  if (
    event.key === "/" &&
    !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
  ) {
    event.preventDefault();
    field?.focus();
  }
});
apply();

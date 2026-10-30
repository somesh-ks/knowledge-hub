/**
 * A page's filter: typing narrows every [data-filter-item] to those whose name or text holds each
 * word, and a section left with none steps aside. A [data-filter-tier] select also keeps only the
 * sections of that [data-tier]. The query is not kept; the page is small enough to start again from
 * the top.
 */
export {};

const field = document.querySelector<HTMLInputElement>("[data-filter]");
const items = Array.from(document.querySelectorAll<HTMLElement>("[data-filter-item]"));
const empty = document.querySelector<HTMLElement>("[data-filter-empty]");
const tier = document.querySelector<HTMLSelectElement>("[data-filter-tier]");

function apply(): void {
  const terms = (field?.value ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const item of items) {
    const text = `${item.dataset.name ?? ""} ${item.textContent ?? ""}`.toLowerCase();
    item.hidden = !terms.every((term) => text.includes(term));
  }
  const wanted = tier?.value ?? "all";
  for (const section of document.querySelectorAll<HTMLElement>(".guide-page section")) {
    const own = section.querySelectorAll("[data-filter-item]");
    const otherTier = wanted !== "all" && !!section.dataset.tier && section.dataset.tier !== wanted;
    const nothingLeft =
      terms.length > 0 &&
      own.length > 0 &&
      !section.querySelector("[data-filter-item]:not([hidden])");
    section.hidden = otherTier || nothingLeft;
  }
  // A jump link to a section that stepped aside would lead nowhere: it steps aside too.
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const target = document.getElementById(link.hash.slice(1))?.closest("section");
    if (target) link.hidden = target.hidden;
  }
  tier?.closest(".sort-field")?.toggleAttribute("data-active", tier.value !== "all");
  // A page's fixed sections (the typeface) stay on screen, so "nothing" is no item left in a shown section.
  const anyItem = items.some((item) => !item.hidden && !item.closest("section")?.hidden);
  if (empty) empty.hidden = anyItem || (terms.length === 0 && tier?.value === "all");
}

field?.addEventListener("input", apply);
tier?.addEventListener("change", apply);
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

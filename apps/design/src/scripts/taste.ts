/**
 * The Taste page's folds: on a wide screen every section is a plain heading and stays open; on a
 * phone they are accordions, with only the first open, so the page reads as a short list of groups.
 * A search or a group choice opens what it found; clearing it puts the folds back as the width
 * wants them. The filtering itself is scripts/filter.ts.
 */
export {};

const folds = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-fold]"));
const field = document.querySelector<HTMLInputElement>("[data-filter]");
const group = document.querySelector<HTMLSelectElement>("[data-filter-tier]");
const wide = matchMedia("(min-width: 40rem)");

const filtering = (): boolean =>
  (field?.value.trim() ?? "") !== "" || (group?.value ?? "all") !== "all";

function settle(): void {
  const all = filtering() || wide.matches;
  folds.forEach((fold, index) => {
    fold.open = all || index === 0;
    // A heading that cannot be toggled should not be a tab stop either.
    fold.querySelector("summary")?.setAttribute("tabindex", wide.matches ? "-1" : "0");
  });
}

// On a wide screen a click or key press on the heading must not shut the section.
for (const fold of folds) {
  fold.querySelector("summary")?.addEventListener("click", (event) => {
    if (wide.matches) event.preventDefault();
  });
}

field?.addEventListener("input", settle);
group?.addEventListener("change", settle);
wide.addEventListener("change", settle);
settle();

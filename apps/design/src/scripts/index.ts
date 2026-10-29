/**
 * The component index: search, the level choice and the category chips filter the cards together,
 * and a query also looks through the colour and token names (search-index.json, fetched on first use).
 * The query lives in the address (?q=) so a search can be shared; "/" focuses the field.
 */
import "./thumbs";

const page = document.querySelector<HTMLElement>("[data-index-url]");
const input = document.querySelector<HTMLInputElement>("[data-guide-search]");
const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-card]"));
const groups = Array.from(document.querySelectorAll<HTMLElement>("[data-group]"));
const count = document.querySelector<HTMLElement>("[data-count]");
const empty = document.querySelector<HTMLElement>("[data-empty]");
const tokenSection = document.querySelector<HTMLElement>("[data-token-results]");
const tokenList = document.querySelector<HTMLElement>("[data-token-list]");

interface Entry {
  kind: string;
  title: string;
  tags: string;
  href: string;
  detail: string;
}
let entries: Promise<Entry[]> | undefined;
const load = (): Promise<Entry[]> => {
  entries ??= fetch(page?.dataset.indexUrl ?? "")
    .then((response) => response.json() as Promise<Entry[]>)
    .catch(() => []);
  return entries;
};

const level = (): string =>
  document.querySelector<HTMLInputElement>('input[name="level"]:checked')?.value ?? "";
const categories = (): string[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[name="category"]:checked')).map(
    (box) => box.value,
  );

async function apply(): Promise<void> {
  const query = (input?.value ?? "").trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const chosenLevel = level();
  const chosen = categories();
  let shown = 0;
  for (const card of cards) {
    const haystack = card.dataset.haystack ?? "";
    const match =
      terms.every((term) => haystack.includes(term)) &&
      (!chosenLevel || card.dataset.level === chosenLevel) &&
      (chosen.length === 0 || chosen.includes(card.dataset.category ?? ""));
    card.hidden = !match;
    if (match) shown++;
  }
  for (const group of groups) group.hidden = !group.querySelector("[data-card]:not([hidden])");

  let others = 0;
  if (tokenSection && tokenList) {
    if (terms.length > 0 && !chosenLevel && chosen.length === 0) {
      const all = await load();
      const found = all
        .filter(
          (entry) =>
            entry.kind !== "component" &&
            terms.every((term) => `${entry.title} ${entry.tags}`.toLowerCase().includes(term)),
        )
        .slice(0, 12);
      tokenList.replaceChildren(
        ...found.map((entry) => {
          const row = document.createElement("a");
          row.className = "row-action";
          row.href = entry.href;
          const text = document.createElement("span");
          text.className = "settings-text";
          const label = document.createElement("span");
          label.className = "settings-label";
          label.textContent = entry.title;
          const hint = document.createElement("span");
          hint.className = "settings-hint";
          hint.textContent = entry.detail;
          text.append(label, hint);
          row.append(text);
          return row;
        }),
      );
      others = found.length;
    } else tokenList.replaceChildren();
    tokenSection.hidden = others === 0;
  }
  if (empty) empty.hidden = shown + others > 0;
  if (count) count.textContent = `${shown} ${shown === 1 ? "component" : "components"}`;
  const url = new URL(location.href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  history.replaceState(null, "", url);
}

const initial = new URL(location.href).searchParams.get("q");
if (input && initial) input.value = initial;
input?.addEventListener("input", apply);
document.addEventListener("change", (event) => {
  if ((event.target as HTMLElement).matches('input[name="level"], input[name="category"]')) apply();
});
addEventListener("keydown", (event) => {
  const active = document.activeElement;
  if (
    event.key === "/" &&
    !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
  ) {
    event.preventDefault();
    input?.focus();
  }
});
if (initial) apply();

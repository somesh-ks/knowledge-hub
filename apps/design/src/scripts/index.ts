/**
 * The overview's search: colour, type and token names, matched as you type (search-index.json,
 * fetched on first use). The query lives in the address (?q=) so a search can be shared; "/" focuses
 * the field.
 */
export {};

const page = document.querySelector<HTMLElement>("[data-index-url]");
const input = document.querySelector<HTMLInputElement>("[data-guide-search]");
const pages = Array.from(document.querySelectorAll<HTMLElement>("[data-pages]"));
const empty = document.querySelector<HTMLElement>("[data-empty]");
const results = document.querySelector<HTMLElement>("[data-token-results]");
const list = document.querySelector<HTMLElement>("[data-token-list]");

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
    .then((response) => {
      if (!response.ok) throw new Error(`Search index request failed: ${response.status}`);
      return response.json() as Promise<Entry[]>;
    })
    // A failed load answers empty now and is tried again on the next search.
    .catch(() => {
      entries = undefined;
      return [];
    });
  return entries;
};

/** The newest apply(); an older one that wakes from the index fetch finds itself stale and stops. */
let latest = 0;

async function apply(): Promise<void> {
  const run = ++latest;
  const query = (input?.value ?? "").trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  let found: Entry[] = [];
  if (terms.length > 0) {
    const all = await load();
    if (run !== latest) return;
    found = all
      .filter((entry) =>
        terms.every((term) => `${entry.title} ${entry.tags}`.toLowerCase().includes(term)),
      )
      .slice(0, 12);
  }
  list?.replaceChildren(
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
  // While a search has results the page's own sections step aside.
  for (const section of pages) section.hidden = terms.length > 0;
  if (results) results.hidden = found.length === 0;
  if (empty) empty.hidden = terms.length === 0 || found.length > 0;
  const url = new URL(location.href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  history.replaceState(null, "", url);
}

const initial = new URL(location.href).searchParams.get("q");
if (input && initial) input.value = initial;
input?.addEventListener("input", apply);
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
apply();

/**
 * The Model page's script. The page is static HTML with the saved choice written in; this loads
 * the live model list, draws the radio rows, and records the one change the choice adds up to in
 * the shared bar. Sending it is managePageSave.ts, loaded the first time Save is pressed, the
 * same step the Schedule page uses.
 *
 * Only pure, dependency-free helpers are imported at run time.
 */
import { contextLabel, isModelId, modelParts } from "../lib/modelId";
import type { ConfigOp } from "../types/contracts";
import type { Pending, SaveContext } from "./managePageSave";

export interface ModelEntry {
  id: string;
  context_length: number | null;
}

const LIST_TIMEOUT_MS = 10_000;

/** The edit a choice stands for. `null` is Automatic. */
export function modelOp(model: string | null): ConfigOp {
  return { op: "writer.set", provider: "nebius", model };
}

/** The list as the API sends it, or null when it is not in the expected shape. */
export function parseModelList(body: unknown): ModelEntry[] | null {
  if (typeof body !== "object" || body === null) return null;
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return null;
  const rows: ModelEntry[] = [];
  for (const entry of models) {
    if (typeof entry !== "object" || entry === null) return null;
    const { id, context_length: context } = entry as { id?: unknown; context_length?: unknown };
    if (typeof id !== "string" || !isModelId(id)) continue;
    rows.push({ id, context_length: typeof context === "number" ? context : null });
  }
  return rows;
}

/** The rows to draw: the live list, with the saved model added when the list no longer has it. */
export function rowsFor(live: readonly ModelEntry[], saved: string | null): ModelEntry[] {
  if (saved === null || live.some((entry) => entry.id === saved)) return [...live];
  return [{ id: saved, context_length: null }, ...live];
}

/** Ids that contain the query, ignoring case. An empty query matches everything. */
export function matchesFilter(id: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || id.toLowerCase().includes(needle);
}

/** What the live region says after a filter. */
export function countText(count: number): string {
  if (count === 0) return "No models match";
  return `${count} ${count === 1 ? "model" : "models"}`;
}

/** The line under a model's name: its vendor and context window, or why it is odd. */
export function hintFor(entry: ModelEntry, listed: boolean): string {
  const { vendor } = modelParts(entry.id);
  const parts = [vendor, listed ? contextLabel(entry.context_length) : "Not in the live list"];
  return parts.filter((part) => part !== "").join(", ");
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One radio row: the input inside a label, with a name and a quiet line. */
function radioRow(value: string, name: string, hint: string, checked: boolean): HTMLLIElement {
  const item = element("li");
  item.dataset.id = value;
  const label = element("label", "manage-pick model-row");
  const input = element("input");
  input.type = "radio";
  input.name = "model";
  input.value = value;
  input.checked = checked;
  input.autocomplete = "off";
  const text = element("span", "manage-text");
  text.append(element("span", "manage-name", name));
  if (hint) text.append(element("span", "manage-quiet", hint));
  label.append(input, text);
  item.append(label);
  return item;
}

function mount(root: HTMLElement): void {
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const bar = one("[data-bar]");
  const text = one("[data-bar-text]");
  const live = one("[data-live]");
  const panel = one("[data-panel]");
  const list = one<HTMLUListElement>("[data-list]");
  const group = one<HTMLFieldSetElement>("[data-models]");
  const filter = one<HTMLInputElement>("#model-filter");
  const count = one("[data-count]");
  const fallback = one("[data-fallback]");
  const typed = one<HTMLInputElement>("#model-typed");
  const typedNote = one("[data-typed-note]");
  const saved = panel.dataset.saved ? panel.dataset.saved : null;
  const changes = new Map<string, Pending>();
  let failed = false;

  const radios = (): HTMLInputElement[] => [
    ...list.querySelectorAll<HTMLInputElement>('input[name="model"]'),
  ];

  const show = (message: string, state: string): void => {
    text.textContent = message;
    live.textContent = message;
    bar.dataset.state = state;
    bar.hidden = false;
    root.setAttribute("data-pending", "");
  };
  const hide = (): void => {
    bar.hidden = true;
    root.removeAttribute("data-pending");
  };

  /** The model the controls hold: a typed id when the list is unavailable, else the checked row. */
  const choice = (): { model: string | null; valid: boolean } => {
    if (failed && typed.value.trim() !== "") {
      const value = typed.value.trim();
      return { model: value, valid: isModelId(value) };
    }
    const picked = radios().find((radio) => radio.checked);
    return { model: picked && picked.value !== "" ? picked.value : null, valid: true };
  };

  const update = (): void => {
    const { model, valid } = choice();
    typed.toggleAttribute("aria-invalid", !valid);
    typedNote.hidden = valid;
    if (!valid) {
      changes.delete("writer");
      hide();
      return;
    }
    if (JSON.stringify(model) === panel.dataset.was) {
      changes.delete("writer");
      hide();
      return;
    }
    changes.set("writer", { op: modelOp(model), el: panel, now: JSON.stringify(model) });
    show("1 change", "idle");
  };

  const applyFilter = (): void => {
    const query = filter.value;
    let shown = 0;
    for (const item of list.querySelectorAll<HTMLLIElement>("li[data-id]")) {
      const id = item.dataset.id ?? "";
      const input = item.querySelector<HTMLInputElement>("input");
      const keep = id === "" ? true : matchesFilter(id, query) || input?.checked === true;
      item.hidden = !keep;
      if (id !== "" && matchesFilter(id, query)) shown += 1;
    }
    count.textContent = query.trim() === "" ? "" : countText(shown);
  };

  const draw = (entries: ModelEntry[], liveList: ModelEntry[] | null): void => {
    list.replaceChildren();
    list.removeAttribute("aria-hidden");
    group.removeAttribute("aria-busy");
    const listed = new Set((liveList ?? []).map((entry) => entry.id));
    list.append(radioRow("", "Automatic", "The engine's own setting", saved === null));
    for (const entry of entries) {
      const { name } = modelParts(entry.id);
      list.append(
        radioRow(
          entry.id,
          name,
          hintFor(entry, liveList === null || listed.has(entry.id)),
          entry.id === saved,
        ),
      );
    }
  };

  const load = async (): Promise<void> => {
    let entries: ModelEntry[] | null = null;
    try {
      const response = await fetch("/api/models", { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (response.ok) entries = parseModelList(await response.json());
    } catch {
      entries = null;
    }
    if (entries === null) {
      failed = true;
      fallback.hidden = false;
      draw(saved === null ? [] : [{ id: saved, context_length: null }], null);
      filter.closest<HTMLElement>("[data-filter]")?.setAttribute("hidden", "");
    } else {
      draw(rowsFor(entries, saved), entries);
      filter.disabled = false;
    }
    root.dataset.loaded = "";
  };

  const context: SaveContext = {
    changes,
    show,
    fields: one("[data-fields]"),
    dialog: one("dialog"),
  };

  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('input[name="model"]')) {
      if (failed) typed.value = "";
      applyFilter();
      update();
    }
  });
  filter.addEventListener("input", applyFilter);
  typed.addEventListener("input", () => {
    // A typed id replaces the radio choice; clearing the field returns to the row that was checked.
    if (typed.value.trim() !== "") for (const radio of radios()) radio.checked = false;
    else {
      const back = radios().find((radio) => radio.value === (saved ?? ""));
      if (back) back.checked = true;
    }
    update();
  });

  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest("button");
    const act = button?.dataset.act;
    if (act === "save") void import("./managePageSave").then((module) => module.save(context));
    else if (act === "close") context.dialog.close();
    else if (act === "dismiss") hide();
    else if (act === "discard") location.reload();
  });

  panel.dataset.was = JSON.stringify(saved);
  root.dataset.ready = "";
  void load();
}

export function installModelPage(): void {
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-manage=model]");
    if (root && root.dataset.ready === undefined) mount(root);
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}

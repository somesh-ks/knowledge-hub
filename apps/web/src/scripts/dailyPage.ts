/**
 * The Daily podcast page's script. The page is static HTML with the saved values written in; this
 * loads the live Nebius model list, runs the model combobox, and records the changes the controls
 * add up to in the shared bar: one schedule.set (time, rhythm, type, length) and one writer.set
 * (provider and model). Sending them is managePageSave.ts, loaded the first time Save is pressed,
 * the same step the Topics page uses.
 *
 * The option logic is pure and lives in lib/combobox.ts. Anthropic's two models are static and
 * never ask for the live list.
 */
import type { ModelOption } from "../lib/combobox";
import { isModelId } from "../lib/modelId";
import type { ConfigOp } from "../types/contracts";
import type { Pending, SaveContext } from "./managePageSave";

type Cadence = 1 | 2 | 3 | 7;
type Format = "readout" | "discussion" | "headlines";
type Length = 3 | 5 | 10 | 15;
export type Provider = "nebius" | "anthropic";

export interface ModelEntry {
  id: string;
  context_length: number | null;
}

const LIST_TIMEOUT_MS = 10_000;

/**
 * The schedule edit the controls stand for. The topics a briefing covers are not chosen here, so
 * the saved ones go back unchanged (null is every enabled topic).
 */
export function scheduleOp(
  values: { hour: number; cadence: number; format: string; length: number },
  sections: string[] | null,
): ConfigOp {
  return {
    op: "schedule.set",
    hour: values.hour,
    cadence_days: values.cadence as Cadence,
    sections,
    format: values.format as Format,
    length_minutes: values.length as Length,
  };
}

/** The edit a provider and model choice stand for. `null` on Nebius is Automatic. */
export function modelOp(model: string | null, provider: Provider = "nebius"): ConfigOp {
  return { op: "writer.set", provider, model };
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

/**
 * The combobox's pure logic is loaded when the page mounts, not with the page's first script: the
 * controls stay inert (see daily.css) for that moment, and the first-load budget is kept.
 */
async function mount(root: HTMLElement): Promise<void> {
  root.dataset.mounting = "";
  const lib = await import("../lib/combobox");
  const { CLAUDE_OPTIONS, countText, filterOptions, labelFor, moveIndex, nebiusOptions } = lib;
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const bar = one("[data-bar]");
  const text = one("[data-bar-text]");
  const live = one("[data-live]");
  const panel = one("[data-panel]");
  const box = one("[data-schedule-box]");
  const hour = one<HTMLSelectElement>("#daily-hour");
  const cadence = one<HTMLSelectElement>("#daily-cadence");
  const checked = (name: string): string =>
    root.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? "";
  const sections = JSON.parse(panel.dataset.sections ?? "null") as string[] | null;

  const group = one("[data-models]");
  const vendor = one<HTMLSelectElement>("#daily-vendor");
  const input = one<HTMLInputElement>("#model-input");
  const listbox = one<HTMLUListElement>("[data-list]");
  const toggle = one<HTMLButtonElement>("[data-toggle]");
  const count = one("[data-count]");
  const fallback = one("[data-fallback]");
  const typed = one<HTMLInputElement>("#model-typed");
  const typedNote = one("[data-typed-note]");
  const savedModel = group.dataset.saved ? group.dataset.saved : null;
  const savedProvider: Provider = group.dataset.provider === "anthropic" ? "anthropic" : "nebius";
  const provider = (): Provider => (vendor.value === "anthropic" ? "anthropic" : "nebius");
  const changes = new Map<string, Pending>();

  /** The live Nebius list: undefined until asked for, null when it failed. */
  let nebius: ModelEntry[] | null | undefined;
  let options: ModelOption[] = [];
  let shown: ModelOption[] = [];
  let selected: string | null = savedModel;
  let active = -1;

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

  /** What the schedule controls hold, as text: the page's starting point and the test for "changed". */
  const scheduleState = (): string =>
    JSON.stringify([hour.value, cadence.value, checked("format"), checked("length")]);

  /** The model the controls hold: a typed id when the list is unavailable, else the chosen option. */
  const choice = (): { model: string | null; valid: boolean } => {
    if (provider() === "nebius" && nebius === null && typed.value.trim() !== "") {
      const value = typed.value.trim();
      return { model: value, valid: isModelId(value) };
    }
    return { model: selected, valid: true };
  };

  const update = (): void => {
    if (scheduleState() === box.dataset.was) changes.delete("schedule");
    else {
      const op = scheduleOp(
        {
          hour: Number(hour.value),
          cadence: Number(cadence.value),
          format: checked("format"),
          length: Number(checked("length")),
        },
        sections,
      );
      changes.set("schedule", { op, el: box, now: scheduleState() });
    }

    const { model, valid } = choice();
    typed.toggleAttribute("aria-invalid", !valid);
    typedNote.hidden = valid;
    const now = JSON.stringify([provider(), model]);
    if (!valid || now === group.dataset.was) changes.delete("writer");
    else changes.set("writer", { op: modelOp(model, provider()), el: group, now });

    if (changes.size === 0) hide();
    else show(changes.size === 1 ? "1 change" : `${changes.size} changes`, "idle");
  };

  const isOpen = (): boolean => !listbox.hidden;

  const close = (): void => {
    listbox.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    // A half-typed query is not a choice: the field goes back to the chosen model's name.
    input.value = labelFor(options, selected);
  };

  const highlight = (index: number): void => {
    active = index;
    listbox.querySelectorAll<HTMLElement>("[role=option]").forEach((item, at) => {
      item.toggleAttribute("data-active", at === index);
    });
    const item = listbox.querySelectorAll<HTMLElement>("[role=option]")[index];
    if (item) {
      input.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };

  /** Draws the options matching `query`, with the recommended ones captioned apart from the rest. */
  const open = (query: string): void => {
    shown = filterOptions(options, query);
    listbox.replaceChildren();
    let last = "";
    shown.forEach((option, index) => {
      if (option.group !== last && option.group !== "") {
        const head = element(
          "li",
          "daily-head",
          option.group === "rec" ? "Recommended" : "All models",
        );
        head.setAttribute("role", "presentation");
        listbox.append(head);
      }
      last = option.group;
      const item = element("li", "daily-option");
      item.id = `model-option-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.id === (selected ?? "")));
      item.dataset.index = String(index);
      item.append(element("span", "daily-option-name", option.label));
      if (option.hint) item.append(element("span", "daily-option-hint", option.hint));
      listbox.append(item);
    });
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");
    count.textContent = countText(shown.length);
    // Typing highlights the first match; opening with the chevron starts on the chosen model.
    const start = query.trim() === "" ? shown.findIndex((o) => o.id === (selected ?? "")) : 0;
    highlight(start);
  };

  const choose = (option: ModelOption): void => {
    selected = option.id === "" ? null : option.id;
    typed.value = "";
    close();
    update();
  };

  /** The options for the vendor on screen. */
  const refresh = (): void => {
    options =
      provider() === "anthropic"
        ? [...CLAUDE_OPTIONS]
        : nebiusOptions(nebius ?? null, savedFor("nebius"));
    fallback.hidden = !(provider() === "nebius" && nebius === null);
    input.value = labelFor(options, selected);
  };
  const savedFor = (which: Provider): string | null =>
    which === savedProvider ? savedModel : null;

  const load = async (): Promise<void> => {
    let entries: ModelEntry[] | null = null;
    try {
      const response = await fetch("/api/models", { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (response.ok) entries = parseModelList(await response.json());
    } catch {
      entries = null;
    }
    nebius = entries;
    // The owner may have moved to Anthropic while the list was loading.
    if (provider() === "nebius") refresh();
    root.dataset.loaded = "";
  };

  const context: SaveContext = {
    changes,
    show,
    fields: one("[data-fields]"),
    dialog: one("dialog"),
  };

  vendor.addEventListener("change", () => {
    // Each vendor starts on its first model: Automatic on Nebius, Claude Sonnet on Anthropic.
    selected = provider() === "anthropic" ? (CLAUDE_OPTIONS[0]?.id ?? null) : null;
    typed.value = "";
    if (provider() === "nebius" && nebius === undefined) void load().then(update);
    refresh();
    update();
  });
  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-panel]") && target !== vendor) update();
  });

  input.addEventListener("input", () => open(input.value));
  input.addEventListener("keydown", (event) => {
    const { key } = event;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen()) open("");
      else highlight(moveIndex(active, shown.length, key));
    } else if (isOpen() && (key === "Home" || key === "End") && event.ctrlKey) {
      event.preventDefault();
      highlight(moveIndex(active, shown.length, key));
    } else if (key === "Enter" && isOpen()) {
      event.preventDefault();
      const option = shown[active];
      if (option) choose(option);
    } else if (key === "Escape" && isOpen()) {
      event.preventDefault();
      close();
    }
  });
  input.addEventListener("focusout", (event) => {
    if (!(event.relatedTarget instanceof Node && listbox.contains(event.relatedTarget))) close();
  });
  // Pressing an option must not blur the field first, or the list would close under the pointer.
  listbox.addEventListener("pointerdown", (event) => event.preventDefault());
  listbox.addEventListener("click", (event) => {
    const item = (event.target as Element).closest<HTMLElement>("[role=option]");
    const option = item ? shown[Number(item.dataset.index)] : undefined;
    if (option) choose(option);
  });
  toggle.addEventListener("pointerdown", (event) => event.preventDefault());
  toggle.addEventListener("click", () => {
    input.focus();
    if (isOpen()) close();
    else open("");
  });
  typed.addEventListener("input", update);

  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest("button");
    const act = button?.dataset.act;
    if (act === "save") void import("./managePageSave").then((module) => module.save(context));
    else if (act === "close") context.dialog.close();
    else if (act === "dismiss") hide();
    else if (act === "discard") location.reload();
  });

  box.dataset.was = scheduleState();
  group.dataset.was = JSON.stringify([savedProvider, savedModel]);
  refresh();
  root.dataset.ready = "";
  if (provider() === "nebius") void load();
  else root.dataset.loaded = "";
}

export function installDailyPage(): void {
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-manage=daily]");
    if (root && root.dataset.mounting === undefined) void mount(root);
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}

/**
 * The editor of the podcast settings pages, loaded by podcastEntry.ts. Each page is static HTML with
 * the saved values written in: a profile page (Daily, Weekly, Custom) or the Model page. This loads
 * the voices and the live Nebius model list, runs the model combobox, and records what the controls
 * add up to: one schedule.set (every field that changed) or one writer.set (provider and model).
 * autosave.ts sends them a moment later through managePageSave.ts, the step the Topics page uses.
 *
 * The option logic is pure and lives in lib/combobox.ts. Anthropic's two models are static and
 * never ask for the live list.
 */
import type { ModelOption } from "../lib/combobox";
import { isModelId } from "../lib/modelId";
import type { ConfigOp } from "../types/contracts";
import { mountAutosave } from "./autosave";
import type { Pending } from "./managePageSave";
import type { FieldValues, scheduleOp as ScheduleOp } from "./podcastProfiles";

export type Provider = "nebius" | "anthropic";

export interface ModelEntry {
  id: string;
  context_length: number | null;
}

const LIST_TIMEOUT_MS = 10_000;

/** What can float over the bottom of the page: the bottom bar, the player, the run card, the Create button. */
const FLOATING = ".app-nav, .player-dock, .run-card, .create-fab, .manage-bar";

/**
 * How far down the screen a list opening under `field` may reach: the top of the highest thing that
 * floats over the page below the field and across its width, or the bottom of the screen.
 */
export function roomFloor(field: DOMRect, covers: readonly DOMRect[], viewport: number): number {
  let floor = viewport;
  for (const cover of covers) {
    const across = cover.width > 0 && cover.left < field.right && cover.right > field.left;
    if (across && cover.top > field.bottom && cover.top < floor) floor = cover.top;
  }
  return floor;
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
 * Mounts the editor on whichever settings page holds it: a profile page (Daily, Weekly, Custom) has
 * schedule fields, the Model page has the writer's vendor and model. podcastEntry.ts loads this file
 * and the combobox's pure logic after the page's first script, so neither counts against the
 * first-load budget. A change is recorded here and sent by autosave.ts a moment later.
 */
export async function mount(root: HTMLElement): Promise<void> {
  const box = root.querySelector<HTMLElement>("[data-panel]") ?? root;
  const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]");
  const changes = new Map<string, Pending>();
  /** The diff, from the profiles script, which loads right after the page is up. */
  let ops: typeof ScheduleOp | undefined;
  /** The writer edit the Model page's controls stand for, or null when they hold the saved one. */
  let writer: (() => Pending | null) | undefined;

  /** What the schedule controls hold: the page's starting point and the test for "changed". */
  const fields = (): FieldValues => {
    const out: FieldValues = {};
    /** A profile's topic chips, which add up to one field: "*" when all are ticked, else the ids. */
    const topics = new Map<string, { all: number; on: string[] }>();
    for (const control of controls) {
      const key = control.dataset.f ?? "";
      if (key.endsWith(".sections") && control instanceof HTMLInputElement) {
        const entry = topics.get(key) ?? { all: 0, on: [] };
        entry.all += 1;
        if (control.checked) entry.on.push(control.value);
        topics.set(key, entry);
      } else if (control instanceof HTMLInputElement && control.type === "radio") {
        out[key] ??= "";
        if (control.checked) out[key] = control.value;
      } else if (control instanceof HTMLInputElement) out[key] = String(control.checked);
      else out[key] = control.value;
    }
    for (const [key, { all, on }] of topics) {
      out[key] = on.length === all ? "*" : on.sort().join(",");
    }
    return out;
  };

  /** Records what the controls now differ by. `save` is false while a typed id is still being typed. */
  const update = (save = true): void => {
    const now = fields();
    const op = ops?.(JSON.parse(box.dataset.was ?? "{}") as FieldValues, now);
    if (op) changes.set("schedule", { op, el: box, now: JSON.stringify(now) });
    else changes.delete("schedule");
    const edit = writer?.() ?? null;
    if (edit) changes.set("writer", edit);
    else changes.delete("writer");
    if (save) autosave.changed();
  };

  const autosave = mountAutosave(root, changes, () => update(false));

  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-profile]")) update();
  });

  box.dataset.was = JSON.stringify(fields());
  if (root.querySelector("[data-profile]")) {
    void import("./podcastProfiles").then((module) => {
      ops = module.scheduleOp;
      module.mountProfiles(root, () => update(false));
    });
  }
  const group = root.querySelector<HTMLElement>("[data-models]");
  if (group) writer = await mountModel(root, group, update);
  root.dataset.ready = "";
}

/**
 * The Model page: the vendor select and the model combobox. Returns what the controls stand for as
 * a pending writer edit, or null while they hold the saved choice.
 */
async function mountModel(
  root: HTMLElement,
  group: HTMLElement,
  update: (save?: boolean) => void,
): Promise<() => Pending | null> {
  const lib = await import("../lib/combobox");
  const {
    CLAUDE_OPTIONS,
    GROUP_NAMES,
    countText,
    filterOptions,
    labelFor,
    moveIndex,
    nebiusOptions,
  } = lib;
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const vendor = one<HTMLSelectElement>("#daily-vendor");
  const input = one<HTMLInputElement>("#model-input");
  const listbox = one("[data-list]");
  const toggle = one<HTMLButtonElement>("[data-toggle]");
  const count = one("[data-count]");
  const fallback = one("[data-fallback]");
  const typed = one<HTMLInputElement>("#model-typed");
  const typedNote = one("[data-typed-note]");
  const savedModel = group.dataset.saved ? group.dataset.saved : null;
  const savedProvider: Provider = group.dataset.provider === "anthropic" ? "anthropic" : "nebius";
  const provider = (): Provider => (vendor.value === "anthropic" ? "anthropic" : "nebius");

  /** The live Nebius list: undefined until asked for, null when it failed. */
  let nebius: ModelEntry[] | null | undefined;
  let options: ModelOption[] = [];
  let shown: ModelOption[] = [];
  let selected: string | null = savedModel;
  let active = -1;

  /** The model the controls hold: a typed id when the list is unavailable, else the chosen option. */
  const choice = (): { model: string | null; valid: boolean } => {
    if (provider() === "nebius" && nebius === null && typed.value.trim() !== "") {
      const value = typed.value.trim();
      return { model: value, valid: isModelId(value) };
    }
    return { model: selected, valid: true };
  };

  const pending = (): Pending | null => {
    const { model, valid } = choice();
    typed.toggleAttribute("aria-invalid", !valid);
    typedNote.hidden = valid;
    const now = JSON.stringify([provider(), model]);
    if (!valid || now === group.dataset.was) return null;
    return { op: modelOp(model, provider()), el: group, now };
  };

  const isOpen = (): boolean => !listbox.hidden;

  const close = (): void => {
    listbox.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    // A half-typed query is not a choice: the field goes back to the chosen model's name.
    input.value = labelFor(options, selected);
    input.removeAttribute("placeholder");
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

  /**
   * Draws the options matching `query`: the top models and the rest each in a group under a quiet
   * heading. The group carries the heading's words as its name, and the heading itself is hidden
   * from screen readers so it is not read twice. `keyboard` marks a list opened or filtered from
   * the keyboard: only then does its current row show the ring, as in a select's list.
   */
  const open = (query: string, keyboard: boolean): void => {
    shown = filterOptions(options, query);
    listbox.replaceChildren();
    let into = listbox;
    let last = "";
    shown.forEach((option, index) => {
      if (option.group !== last) {
        last = option.group;
        into = listbox;
        if (option.group !== "") {
          const name = GROUP_NAMES[option.group];
          into = element("div", "daily-group");
          into.setAttribute("role", "group");
          into.setAttribute("aria-label", name);
          const head = element("div", "daily-head", name);
          head.setAttribute("aria-hidden", "true");
          into.append(head);
          listbox.append(into);
        }
      }
      const item = element("div", "daily-option");
      item.id = `model-option-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.id === (selected ?? "")));
      item.dataset.index = String(index);
      item.append(element("span", "daily-option-name", option.label));
      if (option.hint) item.append(element("span", "daily-option-hint", option.hint));
      into.append(item);
    });
    listbox.hidden = false;
    listbox.toggleAttribute("data-keyboard", keyboard);
    // Opens below the field, and above it when the room under it is short and the room over it is
    // not. Room ends where the bottom bar, the player or the Create button floats over the page, and
    // under the sticky top chrome.
    const field = input.getBoundingClientRect();
    const covers = [...document.querySelectorAll<HTMLElement>(FLOATING)].map((node) =>
      node.getBoundingClientRect(),
    );
    const top = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
    const below = roomFloor(field, covers, window.innerHeight) - field.bottom - 16;
    const above = field.top - (Number.isFinite(top) ? top : 16);
    const wants = Math.min(listbox.scrollHeight, 352);
    const flip = below < wants && above > below;
    listbox.toggleAttribute("data-above", flip);
    listbox.style.setProperty("--list-room", `${Math.max(flip ? above : below, 176)}px`);
    input.setAttribute("aria-expanded", "true");
    count.textContent = countText(shown.length);
    // Typing highlights the first match; opening with the chevron starts on the chosen model.
    const start = query.trim() === "" ? shown.findIndex((o) => o.id === (selected ?? "")) : 0;
    highlight(start);
  };

  /**
   * Opens the whole list from a press on the field or its chevron, as a select would. The chosen
   * model's name waits in the field as its placeholder, so typing filters at once without first
   * deleting it, and closing without a choice puts it back.
   */
  const browse = (): void => {
    input.placeholder = labelFor(options, selected);
    input.value = "";
    open("", false);
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
    if (!isOpen()) input.value = labelFor(options, selected);
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

  vendor.addEventListener("change", () => {
    // Each vendor starts on its first model: Automatic on Nebius, Claude Sonnet on Anthropic.
    selected = provider() === "anthropic" ? (CLAUDE_OPTIONS[0]?.id ?? null) : null;
    typed.value = "";
    if (provider() === "nebius" && nebius === undefined) void load().then(() => update());
    refresh();
    update();
  });

  input.addEventListener("input", () => open(input.value, true));
  // A press opens the list; reached with Tab, the field selects its text so typing replaces it.
  let pressed = false;
  input.addEventListener("pointerdown", () => {
    pressed = true;
    input.dataset.pointer = "";
  });
  input.addEventListener("focus", () => {
    if (!pressed) input.select();
    pressed = false;
  });
  input.addEventListener("click", () => {
    if (!isOpen()) browse();
  });
  input.addEventListener("keydown", (event) => {
    const { key } = event;
    // From the keyboard, the field shows its ring again (podcast.css).
    delete input.dataset.pointer;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen()) open("", true);
      else {
        listbox.toggleAttribute("data-keyboard", true);
        highlight(moveIndex(active, shown.length, key));
      }
    } else if (isOpen() && (key === "Home" || key === "End") && event.ctrlKey) {
      event.preventDefault();
      listbox.toggleAttribute("data-keyboard", true);
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
  listbox.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    input.dataset.pointer = "";
  });
  // The pointer takes over from the keyboard: the hover tint shows the row, the ring goes.
  listbox.addEventListener("pointermove", () => listbox.removeAttribute("data-keyboard"));
  listbox.addEventListener("click", (event) => {
    const item = (event.target as Element).closest<HTMLElement>("[role=option]");
    const option = item ? shown[Number(item.dataset.index)] : undefined;
    if (option) choose(option);
  });
  toggle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    input.dataset.pointer = "";
  });
  toggle.addEventListener("click", () => {
    input.focus();
    if (isOpen()) close();
    else browse();
  });
  // A typed id is saved once it is finished (Enter or leaving the field), not letter by letter.
  typed.addEventListener("input", () => update(false));
  typed.addEventListener("change", () => update());

  group.dataset.was = JSON.stringify([savedProvider, savedModel]);
  refresh();
  if (provider() === "nebius") void load();
  else root.dataset.loaded = "";
  return pending;
}

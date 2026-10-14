/**
 * The editor of the podcast settings pages, loaded by podcastEntry.ts. Each page is static HTML with
 * the saved values written in: a profile page (Daily, Weekly, Custom) or the Model page. This loads
 * the voices and the live Nebius model list, runs the model select, and records what the controls
 * add up to: one schedule.set (every field that changed) or one writer.set (provider and model).
 * autosave.ts sends them a moment later through managePageSave.ts, the step the Topics page uses.
 *
 * The option logic is pure and lives in lib/combobox.ts. Anthropic's two models are static and
 * never ask for the live list.
 */
import { isModelId, NEBIUS_DEFAULT_ID } from "../lib/modelId";
import { clearPendingChoice, readPendingChoice } from "../lib/pendingWriter";
import { hasSaved } from "../lib/savedKey";
import { heldWriter } from "../lib/savedOverlay";
import type { Provider } from "../lib/settingsSummary";
import type { ConfigOp } from "../types/contracts";
import { mountAutosave } from "./autosave";
import type { Pending } from "./managePageSave";
import type { FieldValues, scheduleOp as ScheduleOp } from "./podcastProfiles";

export {
  clearPendingChoice,
  PENDING_WRITER_KEY,
  readPendingChoice,
  type StoredWriterChoice,
  writePendingChoice,
} from "../lib/pendingWriter";
export { roomFloor } from "../lib/roomFloor";
export type { Provider } from "../lib/settingsSummary";

export interface ModelEntry {
  id: string;
  context_length: number | null;
}

const LIST_TIMEOUT_MS = 10_000;

/** The edit a provider and model choice stand for. `null` on Nebius is the model Nebius runs on by itself. */
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

export const NEBIUS_MODELS_CACHE_KEY = "dispatch:nebius-models";
const CATALOG_MAX_AGE_MS = 60 * 60 * 1000;

export function readCachedCatalog(
  storage: Storage | null = typeof sessionStorage !== "undefined" ? sessionStorage : null,
): ModelEntry[] | null {
  try {
    const raw = storage?.getItem(NEBIUS_MODELS_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { models?: unknown; timestamp?: unknown };
    if (
      Array.isArray(data.models) &&
      typeof data.timestamp === "number" &&
      Date.now() - data.timestamp < CATALOG_MAX_AGE_MS
    ) {
      return parseModelList(data);
    }
  } catch {
    // storage unavailable
  }
  return null;
}

export function writeCachedCatalog(
  models: ModelEntry[],
  storage: Storage | null = typeof sessionStorage !== "undefined" ? sessionStorage : null,
): void {
  try {
    storage?.setItem(NEBIUS_MODELS_CACHE_KEY, JSON.stringify({ models, timestamp: Date.now() }));
  } catch {
    // storage unavailable
  }
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
    for (const control of controls) {
      const key = control.dataset.f ?? "";
      if (control instanceof HTMLInputElement && control.type === "radio") {
        out[key] ??= "";
        if (control.checked) out[key] = control.value;
      } else if (control instanceof HTMLInputElement) out[key] = String(control.checked);
      else out[key] = control.value;
    }
    return out;
  };

  // An edit saved in the last few minutes is not in this page until the next build: the controls
  // show it before they are read as the starting point below, so it is not sent again.
  let saved: ConfigOp[] = [];
  if (hasSaved()) {
    const view = await import("./savedView").catch(() => null);
    saved = view?.readSaved() ?? [];
    view?.overlayPodcast(root, controls, fields(), saved);
  }

  /** The topic chips: each puts the topics it stands for in or out of this podcast (topic.scope). */
  // A chip of a topic removed since the build is gone (savedView.ts): it neither counts nor sends.
  const scopeBoxes = [...root.querySelectorAll<HTMLInputElement>("input[data-scope]")].filter(
    (box) => box.dataset.gone === undefined,
  );
  for (const box of scopeBoxes) box.dataset.was = String(box.checked);
  const scopeChanges = (): void => {
    for (const box of scopeBoxes) {
      const profile = box.dataset.scope === "weekly" ? "weekly" : "daily";
      const ids = (box.dataset.scopeIds ?? "").split(" ").filter(Boolean);
      const key = `scope:${profile}:${ids.join(",")}`;
      if (ids.length === 0 || String(box.checked) === box.dataset.was) changes.delete(key);
      else
        changes.set(key, {
          op: { op: "topic.scope", ids, [profile]: box.checked },
          el: box,
          now: String(box.checked),
        });
    }
  };

  /** Topic chips all off: the episode has nothing to cover, which the hint under them says. */
  const noTopics = root.querySelector<HTMLElement>("[data-no-topics]");
  const showNoTopics = (): void => {
    if (noTopics) noTopics.hidden = scopeBoxes.some((box) => box.checked);
  };

  /** Records what the controls now differ by. `save` is false while a typed id is still being typed. */
  const update = (save = true): void => {
    scopeChanges();
    showNoTopics();
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
  showNoTopics();
  if (root.querySelector("[data-profile]")) {
    void import("./podcastProfiles").then((module) => {
      ops = module.scheduleOp;
      module.mountProfiles(root, () => update(false));
    });
    // The time zone and the voices are chosen from a list with a search field.
    void import("./picker").then((module) => module.mountPickers(root));
  }
  const group = root.querySelector<HTMLElement>("[data-models]");
  if (group) writer = await mountModel(root, group, update, saved);
  root.dataset.ready = "";
}

/**
 * The Model page: the vendor select and the model select. Returns what the controls stand for as
 * a pending writer edit, or null while they hold the saved choice.
 */
async function mountModel(
  root: HTMLElement,
  group: HTMLElement,
  update: (save?: boolean) => void,
  saved: readonly ConfigOp[],
): Promise<() => Pending | null> {
  const { CLAUDE_OPTIONS, claudeOptions, nebiusOptions } = await import("../lib/combobox");
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const vendor = one<HTMLSelectElement>("#daily-vendor");
  const select = one<HTMLSelectElement>("#model-select");
  const savedModel = group.dataset.saved ? group.dataset.saved : null;
  const savedProvider: Provider = group.dataset.provider === "anthropic" ? "anthropic" : "nebius";

  // A choice the build has not brought yet: one still on its way from a page left in the server's
  // gap, else the writer's note of one saved (written once its request went through, managePageSave).
  // Shown in place of the built one, and the starting point a later change is measured from.
  const held = heldWriter(saved);
  let pendingChoice = held ?? readPendingChoice();
  if (pendingChoice) {
    if (pendingChoice.provider === savedProvider && pendingChoice.model === savedModel) {
      if (!held) clearPendingChoice();
      pendingChoice = null;
    } else {
      vendor.value = pendingChoice.provider;
      void import("./savedView").then((view) => view.markSaved(root));
    }
  }

  const provider = (): Provider => (vendor.value === "anthropic" ? "anthropic" : "nebius");

  /** The live Nebius list: initialized from cache if available, null when it failed. */
  let nebius: ModelEntry[] | null | undefined = readCachedCatalog() ?? undefined;
  let selected: string | null =
    pendingChoice && pendingChoice.provider === provider() ? pendingChoice.model : savedModel;

  const pending = (): Pending | null => {
    const now = JSON.stringify([provider(), selected]);
    if (now === group.dataset.was) return null;
    return { op: modelOp(selected, provider()), el: group, now };
  };

  /**
   * Draws the options for the vendor on screen. The chosen model is always one of them, even when
   * neither the top models nor the live list have it, so an id saved earlier is shown and kept.
   */
  const refresh = (): void => {
    const options =
      provider() === "anthropic"
        ? claudeOptions(selected)
        : nebiusOptions(nebius ?? null, selected);
    const groups: Record<string, HTMLElement> = {};
    select.replaceChildren();
    for (const option of options) {
      const item = document.createElement("option");
      item.value = option.id;
      item.textContent =
        option.hint === "Not in the live list"
          ? `${option.label} (not in the live list)`
          : option.label;
      let into: HTMLElement = select;
      if (option.group !== "") {
        into = groups[option.group] ??= (() => {
          const optgroup = document.createElement("optgroup");
          optgroup.label = option.group === "top" ? "Top models" : "All models";
          // A drawn list shows a legend in place of the label, where it can be lined up with the
          // options' words; a native list keeps the label.
          const legend = document.createElement("legend");
          legend.textContent = optgroup.label;
          optgroup.append(legend);
          select.append(optgroup);
          return optgroup;
        })();
      }
      into.append(item);
    }
    // Nothing saved on Nebius shows what Nebius runs on then; it is saved only once picked.
    select.value =
      selected ??
      (options.some((option) => option.id === NEBIUS_DEFAULT_ID)
        ? NEBIUS_DEFAULT_ID
        : (options[0]?.id ?? ""));
  };

  const load = async (): Promise<void> => {
    let entries: ModelEntry[] | null = null;
    try {
      const response = await fetch("/api/models", { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (response.ok) {
        entries = parseModelList(await response.json());
        if (entries && entries.length > 0) writeCachedCatalog(entries);
      }
    } catch {
      entries = null;
    }
    if (entries !== null || nebius === undefined) {
      nebius = entries;
      if (provider() === "nebius") refresh();
    }
    root.dataset.loaded = "";
  };

  vendor.addEventListener("change", () => {
    // Each vendor starts on its first model: GLM-5.3 on Nebius, Claude Sonnet on Anthropic.
    selected = provider() === "anthropic" ? (CLAUDE_OPTIONS[0]?.id ?? null) : NEBIUS_DEFAULT_ID;
    if (provider() === "nebius" && nebius === undefined) void load().then(() => update());
    refresh();
    update();
  });

  select.addEventListener("change", () => {
    selected = select.value;
    update();
  });

  group.dataset.was = JSON.stringify(
    pendingChoice ? [pendingChoice.provider, pendingChoice.model] : [savedProvider, savedModel],
  );
  refresh();
  if (provider() === "nebius") void load();
  else root.dataset.loaded = "";
  return pending;
}

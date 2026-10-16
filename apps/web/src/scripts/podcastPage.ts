/**
 * The editor of the podcast settings, loaded by podcastEntry.ts. Each page is static HTML with the
 * saved values written in: a profile page (Daily, Weekly) or the Settings index, which holds the
 * model select. This loads the voices and the live model lists, runs the model select, and records what the controls
 * add up to: one schedule.set (every field that changed) or one writer.set (provider and model).
 * autosave.ts sends them a moment later through managePageSave.ts, the step the Topics page uses.
 *
 * The option logic is pure and lives in lib/combobox.ts. Both live lists are asked for once the page
 * is up; without them the select offers the built-in Claude models and the curated Nebius ones.
 */
import { isModelId, NEBIUS_DEFAULT_ID, providerOf } from "../lib/modelId";
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

/** Anthropic's list as the API sends it, or null when it is not in the expected shape. */
export function parseClaudeList(body: unknown): { id: string; label: string }[] | null {
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return null;
  const rows: { id: string; label: string }[] = [];
  for (const entry of models) {
    const { id, label } = (entry ?? {}) as { id?: unknown; label?: unknown };
    if (typeof id !== "string" || !id.startsWith("claude-") || !isModelId(id)) continue;
    rows.push({ id, label: typeof label === "string" && label ? label : id });
  }
  return rows.length > 0 ? rows : null;
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
 * Mounts the editor on whichever settings page holds it: a profile page (Daily, Weekly) has
 * schedule fields, the Settings index has the writer's model select. podcastEntry.ts loads this file
 * and the combobox's pure logic after the page's first script, so neither counts against the
 * first-load budget. A change is recorded here and sent by autosave.ts a moment later.
 */
export async function mount(root: HTMLElement): Promise<void> {
  const box = root.querySelector<HTMLElement>("[data-panel]") ?? root;
  const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]");
  const changes = new Map<string, Pending>();
  /** The diff, from the profiles script, which loads right after the page is up. */
  let ops: typeof ScheduleOp | undefined;
  /** The writer edit the model select stands for, or null when they hold the saved one. */
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
 * The one model select: Claude's three families and the top Nebius models in two groups. Returns
 * what the select stands for as a pending writer edit, or null while it holds the saved choice. The
 * vendor is implied by the id (providerOf).
 */
async function mountModel(
  root: HTMLElement,
  group: HTMLElement,
  update: (save?: boolean) => void,
  saved: readonly ConfigOp[],
): Promise<() => Pending | null> {
  const { writerOptions } = await import("../lib/combobox");
  const select = root.querySelector("#model-select") as HTMLSelectElement;
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
    } else void import("./savedView").then((view) => view.markSaved(root));
  }

  /** The live lists: Nebius's from cache when kept; null when not read (the built-in ones stand in). */
  let nebius: ModelEntry[] | null = readCachedCatalog();
  let claude: { id: string; label: string }[] | null = null;
  let selected: string | null = pendingChoice ? pendingChoice.model : savedModel;
  const provider = (): Provider => (selected === null ? savedProvider : providerOf(selected));

  const pending = (): Pending | null => {
    const now = JSON.stringify([provider(), selected]);
    if (now === group.dataset.was) return null;
    return { op: modelOp(selected, provider()), el: group, now };
  };

  /**
   * Draws the options. The chosen model is always one of them, even when neither list offers it, so
   * an id saved earlier is shown and kept.
   */
  const refresh = (): void => {
    const options = writerOptions(selected, claude, nebius);
    const groups: Record<string, HTMLElement> = {};
    select.replaceChildren();
    for (const option of options) {
      const item = document.createElement("option");
      item.value = option.id;
      item.textContent = option.label;
      let into: HTMLElement = select;
      if (option.group !== "") {
        into = groups[option.group] ??= (() => {
          const optgroup = document.createElement("optgroup");
          optgroup.label = option.group;
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

  /** One live list, or null when it cannot be read. */
  const fetchList = async <T>(
    url: string,
    parse: (body: unknown) => T | null,
  ): Promise<T | null> => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      return response.ok ? parse(await response.json()) : null;
    } catch {
      return null;
    }
  };

  select.addEventListener("change", () => {
    selected = select.value;
    update();
  });

  group.dataset.was = JSON.stringify(
    pendingChoice ? [pendingChoice.provider, pendingChoice.model] : [savedProvider, savedModel],
  );
  refresh();
  void Promise.all([
    fetchList("/api/models", parseModelList),
    fetchList("/api/models?provider=anthropic", parseClaudeList),
  ]).then(([nebiusList, claudeList]) => {
    // A list that could not be read leaves the cached or built-in models in place.
    if (nebiusList && nebiusList.length > 0) {
      nebius = nebiusList;
      writeCachedCatalog(nebiusList);
    }
    claude = claudeList;
    refresh();
    root.dataset.loaded = "";
  });
  return pending;
}

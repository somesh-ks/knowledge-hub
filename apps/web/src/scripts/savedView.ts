/**
 * What a settings page shows of an edit saved in the last few minutes, before the build that puts it
 * in the page (lib/savedOverlay.ts says what was saved; this puts it in the controls). Loaded only
 * when something saved is kept (hasSaved), and by the topics editor for a topic just added, whose
 * suggested sources it ranks from the catalogue in the browser. Never in a page's first load.
 *
 * A control takes the saved value as its starting point, so the editors read it as unchanged and
 * never send it again. The page says once, under its title, that what it shows is saved and not live.
 */
import { outletsSummary, savedBlocked } from "../lib/blockedOutlets";
import { chosenSummary } from "../lib/multiSelect";
import { SAVED_KEY } from "../lib/savedKey";
import {
  anyPending,
  type FieldValues,
  parseSaved,
  type SourceSpot,
  savedControl,
  savedFields,
  savedOps,
  savedScope,
  savedSources,
  savedTopics,
  sourceCounts,
} from "../lib/savedOverlay";
import { sourcesSummary } from "../lib/settingsSummary";
import {
  type CatalogSource,
  cadenceLabel,
  catalogHost,
  type HeldSource,
  parseSourceCatalog,
  suggestSources,
  type TopicWords,
} from "../lib/sourceCatalogMatch";
import { parseSuggestedAdd, type SuggestedAdd } from "../lib/topicText";
import { drawStop, stopFor, weightOf } from "../lib/weightStops";
import type { ConfigOp } from "../types/contracts";
import { ADDED_SOURCE, ADDED_TOPIC, HELD_EVENT, type Held, type Pending } from "./managePageSave";
import { element, iconNode } from "./topicsView";

/** The row a topic waits in until the build (ManageChrome.astro), among the page's templates. */
export const QUEUED_ROW = "template:not(#topics-panel-template, #suggested-template)";

/** The page that lists the sources no topic page shows (OTHER_ID in lib/topicPages.ts). */
const OTHER_PAGE = "other";

/** The edits still waiting for the build, in the order they were saved. Forgets them once none is. */
export function readSaved(now = Date.now()): ConfigOp[] {
  try {
    const entries = parseSaved(localStorage.getItem(SAVED_KEY), now);
    if (entries.length === 0) localStorage.removeItem(SAVED_KEY);
    return savedOps(entries, now);
  } catch {
    return [];
  }
}

/**
 * The line under the title, once the run that held an edit shown here failed: the page took the edit
 * as its own (adopt, in managePageSave.ts), so the toast's Retry or the next change sends it.
 */
export const NOT_SAVED_NOTE = "Not saved yet. It goes with your next change.";

/** Whether an edit shown is still on its way. */
export function readPending(now = Date.now()): boolean {
  try {
    return anyPending(parseSaved(localStorage.getItem(SAVED_KEY), now), now);
  } catch {
    return false;
  }
}

/**
 * A page showing saved edits says nothing about them, as a native setting would: the controls show
 * the change. Only an edit a left page's run still holds gets a line under the title, hidden until
 * that run fails.
 */
export function markSaved(root: HTMLElement): void {
  const head = root.querySelector(".settings-head");
  if (!head || head.querySelector("[data-saved-note]") || !readPending()) return;
  const note = element("p", "manage-quiet", NOT_SAVED_NOTE);
  note.dataset.savedNote = "";
  note.hidden = true;
  head.append(note);
  followHeld(root, note);
}

/**
 * Follows a left page's run to its end. When it failed, the page holds those edits as its own
 * (autosave.ts takes them), and the line and any row that said Added say they are not saved yet,
 * until a request carries them.
 */
export function followHeld(root: HTMLElement, note: HTMLElement): void {
  const off = new AbortController();
  const lost = new Set<Pending>();
  const say = (): void => {
    note.hidden = lost.size === 0;
  };
  document.addEventListener(
    HELD_EVENT,
    (event) => {
      if (!root.isConnected) return off.abort();
      for (const pending of (event as CustomEvent<Held>).detail.lost) {
        const lines = addedLines(root, pending.op);
        const mark = (saved: boolean): void => {
          for (const [line, done] of lines) line.textContent = saved ? done : TOPIC_NOT_ADDED;
          if (saved) lost.delete(pending);
          else lost.add(pending);
          say();
        };
        pending.fail = () => mark(false);
        pending.done = () => mark(true);
        mark(false);
      }
      say();
    },
    { signal: off.signal },
  );
  document.addEventListener("astro:after-swap", () => off.abort(), { signal: off.signal });
}

/** What a row that waits for a refused add says (TOPIC_NOT_ADDED in topicsEditor.ts). */
const TOPIC_NOT_ADDED = "Not added yet. It goes with your next change.";

/** The lines on this page that say an edit was added: a queued topic's, a suggested source's. */
function addedLines(root: HTMLElement, op: ConfigOp): [Element, string][] {
  const lines: [Element, string][] = [];
  if (op.op === "topic.upsert") {
    const note = root.querySelector(`[data-topic-id="${op.topic.id}"] .manage-quiet`);
    if (note) lines.push([note, ADDED_TOPIC]);
  } else if (op.op === "source.add") {
    for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-suggested-add]")) {
      const note = button.closest("li")?.querySelector(".source-note");
      if (note && parseSuggestedAdd(button.dataset.suggestedAdd)?.feed_url === op.url)
        lines.push([note, ADDED_SOURCE]);
    }
  }
  return lines;
}

// ------------------------------------------------------------------------------------- podcast pages

/**
 * A podcast page: the schedule controls and the topic chips take what was saved. `baked` is what the
 * controls hold as built. Runs before the editor reads its starting point. True when anything showed.
 */
export function overlayPodcast(
  root: HTMLElement,
  controls: Iterable<HTMLInputElement | HTMLSelectElement>,
  baked: FieldValues,
  ops = readSaved(),
): boolean {
  const saved = savedFields(baked, ops);
  let shown = Object.keys(saved).length > 0;
  for (const control of controls) {
    const value = saved[control.dataset.f ?? ""];
    if (value === undefined) continue;
    if (control instanceof HTMLSelectElement) {
      // A voice the page was not built with: listed as the page lists a saved one until the list loads.
      if (![...control.options].some((option) => option.value === value))
        control.append(new Option("Saved voice", value));
      control.value = value;
    } else if (control.type === "radio") control.checked = control.value === value;
    else control.checked = value === "true";
  }
  const { removedTopics } = savedTopics(ops);
  for (const box of root.querySelectorAll<HTMLInputElement>("input[data-scope]")) {
    const ids = (box.dataset.scopeIds ?? "").split(" ").filter(Boolean);
    // A topic removed since the build has no chip: the editor never sends a scope for it.
    if (ids.length > 0 && ids.every((id) => removedTopics.has(id))) {
      box.dataset.gone = "";
      const chip = box.closest<HTMLElement>("label");
      if (chip) chip.hidden = true;
      shown = true;
      continue;
    }
    const inScope = savedScope(ops, box.dataset.scope ?? "", ids);
    if (inScope === undefined || inScope === box.checked) continue;
    box.checked = inScope;
    shown = true;
  }
  if (shown) markSaved(root);
  return shown;
}

// -------------------------------------------------------------------------------------- topic pages

/** A MultiSelect shows its hidden checkbox's state: the option's tick and the field's words. */
function syncChoice(input: HTMLInputElement): void {
  const box = input.closest<HTMLElement>("[data-multiselect]");
  if (!box) return;
  for (const option of box.querySelectorAll<HTMLElement>("[role=option]"))
    if (option.dataset.value === input.value)
      option.setAttribute("aria-selected", String(input.checked));
  const labels = [...box.querySelectorAll("[role=option][aria-selected=true] .multiselect-label")];
  const value = box.querySelector("[data-multiselect-value]");
  if (value)
    value.textContent = chosenSummary(
      labels.map((label) => label.textContent ?? ""),
      box.querySelectorAll("[role=option]").length,
      box.dataset.all,
      box.dataset.empty,
    );
}

const byId = <T extends HTMLElement>(root: ParentNode, selector: string, id: string): T | null =>
  [...root.querySelectorAll<T>(selector)].find((node) => node.dataset.id === id) ?? null;

/**
 * The Topics list and a topic's page: switches, sliders, checkboxes and scope take what was saved; a
 * removed topic or source goes as it does once saved; a new name shows; an added feed's + shows its
 * check; a topic added on the list waits there, saved, with its suggested sources. True when anything
 * showed. Runs before the editor loads, which then reads the saved values as its starting point.
 */
export function overlayTopics(root: HTMLElement, ops = readSaved()): boolean {
  if (ops.length === 0) return false;
  let shown = false;
  for (const control of root.querySelectorAll<HTMLInputElement>("input[data-op]")) {
    let op: ConfigOp;
    try {
      op = JSON.parse(control.dataset.op ?? "");
    } catch {
      continue;
    }
    const value = savedControl(ops, op, control.dataset.field ?? "");
    if (value === undefined) continue;
    if (control.type === "range") {
      if (weightOf(control) === Number(value)) continue;
      const place = String(stopFor(control, Number(value)));
      control.defaultValue = place;
      control.value = place;
      drawStop(control);
    } else {
      const on = value === "true";
      if (control.checked === on) continue;
      control.defaultChecked = on;
      control.checked = on;
      syncChoice(control);
    }
    shown = true;
  }

  const saved = savedTopics(ops);
  for (const id of saved.removedTopics) {
    const topic = byId(root, "[data-topic]", id);
    const row = root.querySelector<HTMLElement>(`a.row-action[href="/settings/topics/${id}"]`);
    if (topic) {
      // A removed topic's own page has nothing to show: the list takes its place, in history too.
      topic.setAttribute("data-gone", "");
      globalThis.location?.replace("/settings/topics");
    }
    if (row) row.hidden = true;
    shown ||= Boolean(topic || row);
  }
  for (const id of saved.removedSources) {
    const row = byId(root, "li.source-row", id);
    row?.setAttribute("data-gone", "");
    shown ||= Boolean(row);
  }
  for (const [id, topic] of saved.topics) shown = renameTopic(root, id, topic) || shown;
  for (const [id, edit] of saved.sources) shown = editSource(root, id, edit) || shown;
  for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-suggested-add]")) {
    const offer = parseSuggestedAdd(button.dataset.suggestedAdd);
    if (offer && saved.feeds.has(offer.feed_url) && !button.disabled) {
      showAdded(button, offer);
      shown = true;
    }
  }
  shown = addTopics(root, saved.topics, saved.feeds) || shown;
  shown = recount(root, ops) || shown;
  shown = recountBlocked(root, ops) || shown;
  if (shown) markSaved(root);
  return shown;
}

/** On the list: the Blocked outlets row counts the outlets blocked once the saved edits land. */
function recountBlocked(root: HTMLElement, ops: readonly ConfigOp[]): boolean {
  const hint = root.querySelector<HTMLElement>("[data-blocked-hint]");
  if (!hint) return false;
  let built: string[] = [];
  try {
    built = JSON.parse(hint.dataset.blocked ?? "[]");
  } catch {
    return false;
  }
  const text = outletsSummary(savedBlocked(built, ops).length);
  if (hint.textContent?.trim() === text) return false;
  hint.textContent = text;
  return true;
}

/**
 * On the list: each row's line counts the sources it will list once the build lands (switched off,
 * moved, removed or added since).
 */
function recount(root: HTMLElement, ops: readonly ConfigOp[]): boolean {
  const list = root.querySelector<HTMLElement>("[data-spots]");
  if (!list) return false;
  let base: Record<string, SourceSpot> = {};
  try {
    base = JSON.parse(list.dataset.spots ?? "{}");
  } catch {
    return false;
  }
  const rows = [...list.querySelectorAll<HTMLElement>("a.row-action[data-page]")];
  const pages = new Map<string, string>();
  for (const row of rows)
    for (const id of (row.dataset.members ?? "").split(" ").filter(Boolean))
      pages.set(id, row.dataset.page ?? "");
  const spots = savedSources(base, ops, (id) => pages.get(id ?? "") ?? OTHER_PAGE);
  let shown = false;
  for (const row of rows) {
    const page = row.dataset.page ?? "";
    const { total, on } = sourceCounts(spots, page);
    const text = sourcesSummary({ total, on, never: row.dataset.never !== undefined });
    const hint = row.querySelector("[data-hint]");
    // The built line may carry the template's own spaces: a line that reads the same is no change.
    if (!hint || hint.textContent?.trim() === text) continue;
    hint.textContent = text;
    shown = true;
  }
  return shown;
}

type Upsert = Extract<ConfigOp, { op: "topic.upsert" }>["topic"];

/** A topic's new name and what counts, on its page and on its row in the list. */
function renameTopic(root: HTMLElement, id: string, topic: Upsert): boolean {
  let shown = false;
  const row = root.querySelector(`a.row-action[href="/settings/topics/${id}"] .settings-label`);
  if (row && row.textContent !== topic.name) {
    row.textContent = topic.name;
    shown = true;
  }
  const trigger = root.querySelector<HTMLElement>("[data-edit-topic]");
  if (!byId(root, "[data-topic]", id) || !trigger) return shown;
  const facts = JSON.parse(trigger.dataset.editTopic ?? "{}") as Partial<Upsert>;
  if (facts.id !== id || (facts.name === topic.name && facts.description === topic.description))
    return shown;
  const { name, description, keywords } = topic;
  trigger.dataset.editTopic = JSON.stringify({ ...facts, name, description, keywords });
  trigger.setAttribute("aria-label", `Edit topic ${name}`);
  const title = document.getElementById("page-title");
  if (title) title.textContent = name;
  const note = root.querySelector(".settings-note");
  if (note) note.textContent = description;
  // A later edit sends the topic with these details, not the ones it was built with.
  const base = JSON.parse(trigger.dataset.topicBase ?? "{}");
  trigger.dataset.topicBase = JSON.stringify({
    ...base,
    topic: { ...base.topic, name, description, keywords },
  });
  return true;
}

/** A source's new name, and the topic it moves to after the build. */
function editSource(
  root: HTMLElement,
  id: string,
  edit: { name?: string; topic_ids?: string[] },
): boolean {
  const row = byId(root, "li.source-row", id);
  const button = row?.querySelector<HTMLElement>("[data-edit-source]");
  if (!row || !button) return false;
  const facts = JSON.parse(button.dataset.editSource ?? "{}") as {
    name?: string;
    topic_id?: string;
    topic_name?: string;
  };
  let shown = false;
  if (edit.name !== undefined && edit.name !== facts.name) {
    facts.name = edit.name;
    row.dataset.name = edit.name.toLowerCase();
    const name = row.querySelector(".source-name");
    if (name) name.textContent = edit.name;
    button.setAttribute("aria-label", `Edit ${edit.name}`);
    shown = true;
  }
  const topicId = edit.topic_ids ? (edit.topic_ids[0] ?? "") : undefined;
  if (topicId !== undefined && topicId !== (facts.topic_id ?? "")) {
    const panel = document.querySelector<HTMLTemplateElement>("#topics-panel-template");
    const options = panel?.content.querySelectorAll<HTMLOptionElement>("[data-edit-topic] option");
    const chosen = [...(options ?? [])].find((option) => option.value === topicId);
    facts.topic_id = topicId;
    facts.topic_name = chosen?.text ?? (topicId || "Other");
    let note = row.querySelector<HTMLElement>(".source-note");
    if (!note) {
      note = element("span", "source-note");
      row.querySelector(".source-text")?.append(note);
    }
    note.textContent = `Moves to ${facts.topic_name} in about a minute.`;
    shown = true;
  }
  button.dataset.editSource = JSON.stringify(facts);
  return shown;
}

/** A suggestion's + once its feed is added: the check, and the line that says so. */
function showAdded(button: HTMLButtonElement, offer: Pick<SuggestedAdd, "name">): void {
  button.disabled = true;
  button.classList.add("is-added");
  button.setAttribute("aria-label", `Added ${offer.name}`);
  button
    .closest("li")
    ?.querySelector(".source-meta")
    ?.replaceChildren(element("span", "source-note", ADDED_SOURCE));
}

/** On the list: each topic saved since the build, waiting where a topic just added waits. */
function addTopics(root: HTMLElement, topics: Map<string, Upsert>, feeds: Set<string>): boolean {
  const queued = root.querySelector<HTMLElement>("[data-queued]");
  const template = root.querySelector<HTMLTemplateElement>(QUEUED_ROW);
  if (!queued || !template) return false;
  const taken = new Set((root.dataset.taken ?? "").split(" "));
  let shown = false;
  for (const [id, topic] of topics) {
    if (taken.has(id) || queued.querySelector(`[data-topic-id="${id}"]`)) continue;
    const row = template.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
    if (!row) continue;
    row.dataset.topicId = id;
    const name = row.querySelector("[data-q-name]");
    if (name) name.textContent = topic.name;
    const note = row.querySelector(".manage-quiet");
    if (note) note.textContent = ADDED_TOPIC;
    queued.append(row);
    void suggestUnder(row, topic, feeds);
    shown = true;
  }
  return shown;
}

// ------------------------------------------------------------------------------ suggested sources

interface Catalog {
  sources: CatalogSource[];
  held: HeldSource[];
}

let catalog: Promise<Catalog | null> | undefined;

/**
 * The catalogue and the sites already read, built with the site (pages/settings/source-catalog.json.ts).
 * Asked for once, when the Add panel first opens, so it is in by the time a topic is added.
 */
export function loadCatalog(): Promise<Catalog | null> {
  catalog ??= fetch("/settings/source-catalog.json")
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      if (typeof body !== "object" || body === null) return null;
      const held = (body as { held?: unknown }).held;
      return {
        sources: parseSourceCatalog(body),
        held: Array.isArray(held)
          ? held.filter(
              (source): source is HeldSource =>
                typeof source === "object" &&
                source !== null &&
                typeof (source as HeldSource).host === "string",
            )
          : [],
      };
    })
    .catch(() => null);
  return catalog;
}

/** One suggested source's row, cloned from the template's item and filled; its + carries the add. */
export function suggestionLine(item: Element, offer: CatalogSource, topicId: string): HTMLElement {
  const line = item.cloneNode(true) as HTMLElement;
  const site = offer.url ?? offer.feed_url;
  const icon = /^https?:/.test(site) ? `https://${new URL(site).hostname}/favicon.ico` : null;
  line.querySelector(".source-icon")?.replaceWith(iconNode(icon, offer.name));
  (line.querySelector(".source-name") as HTMLElement).textContent = offer.name;
  (line.querySelector(".source-host") as HTMLElement).textContent = catalogHost(offer);
  const cadence = cadenceLabel(offer.cadence);
  if (cadence)
    line.querySelector(".source-meta")?.append(element("span", "source-cadence", cadence));
  const about = line.querySelector(".source-line") as HTMLElement;
  if (offer.about) about.append(element("span", "source-about", offer.about));
  else about.remove();
  const button = line.querySelector("button") as HTMLButtonElement;
  const adding: SuggestedAdd = {
    name: offer.name,
    feed_url: offer.feed_url,
    favicon_url: icon,
    topic_id: topicId,
  };
  button.dataset.suggestedAdd = JSON.stringify(adding);
  button.setAttribute("aria-label", `Add ${offer.name}`);
  return line;
}

/**
 * The catalogue's feeds that fit a topic not built yet, under its row in the list, each with the +
 * a topic's page has: the same suggestSources the build runs, so its page offers the same ones.
 * `feeds` are those already added, whose + shows its check. Nothing fits, nothing shown.
 */
export async function suggestUnder(
  row: HTMLElement,
  topic: TopicWords & { id: string },
  feeds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const loaded = await loadCatalog();
  const offers = loaded ? suggestSources(loaded.sources, loaded.held, topic) : [];
  const template = document.querySelector<HTMLTemplateElement>("#suggested-template");
  const [shell, item] = template ? [...template.content.children] : [];
  if (offers.length === 0 || !shell || !item || !row.isConnected) return;
  const section = shell.cloneNode(true) as HTMLElement;
  const list = section.querySelector("ul");
  list?.setAttribute("aria-label", `Suggested sources for ${topic.name}`);
  for (const offer of offers) {
    const line = suggestionLine(item, offer, topic.id);
    list?.append(line);
    const button = line.querySelector("button") as HTMLButtonElement;
    if (feeds.has(offer.feed_url)) showAdded(button, offer);
  }
  row.append(section);
}

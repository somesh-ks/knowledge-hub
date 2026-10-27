/**
 * What a settings page shows of an edit saved in the last few minutes, before the build that puts it
 * in the page (lib/savedOverlay.ts says what was saved; this puts it in the controls). Loaded only
 * when something saved is kept (hasSaved), and by the topics editor for a topic just added, whose
 * suggested sources it ranks from the catalogue in the browser. Never in a page's first load.
 *
 * A control takes the saved value as its starting point, so the editors read it as unchanged and
 * never send it again. The page says once, under its title, that what it shows is saved and not live.
 */

import type { SourceFormat } from "@singularity/core";
import { topicEmoji } from "@singularity/core/topicEmoji";
import { outletsSummary, savedBlocked } from "../lib/blockedOutlets";
import { chosenSummary } from "../lib/multiSelect";
import { SAVED_KEY } from "../lib/savedKey";
import {
  anyPending,
  type FieldValues,
  parseSaved,
  type SourceSpot,
  savedChips,
  savedControl,
  savedFields,
  savedOps,
  savedScope,
  savedSources,
  savedTopics,
  sourceCounts,
  withStore,
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
import { FORMAT_LABEL, fold, searchText } from "../lib/sourceFilter";
import { fillShellText, parseSuggestedAdd, type SuggestedAdd } from "../lib/topicText";
import { drawStop, stopFor, weightOf } from "../lib/weightStops";
import type { ConfigOp, ConfigReadBody, StoreSource } from "../types/contracts";
import { storeRead } from "./configStoreRead";
import { ADDED_SOURCE, HELD_EVENT, type Held, type Pending } from "./managePageSave";
import { element, iconNode, storedSourceRow, topicRow } from "./topicsView";

export { loadStore } from "./configStoreRead";

/** The page that lists the sources no topic page shows (OTHER_ID in lib/topicPages.ts). */
const OTHER_PAGE = "other";

/**
 * The edits still waiting for the build, in the order they were saved. Forgets them once none is.
 * With the config store on (D149) the store's edits come first, read by loadStore before this.
 */
export function readSaved(now = Date.now()): ConfigOp[] {
  const store = storeRead();
  try {
    const entries = parseSaved(localStorage.getItem(SAVED_KEY), now);
    if (entries.length === 0) localStorage.removeItem(SAVED_KEY);
    return withStore(entries, store, now);
  } catch {
    return store?.ops ?? [];
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

/** The lines on this page that say an edit was added: a new topic's row, a suggested source's. */
function addedLines(root: HTMLElement, op: ConfigOp): [Element, string][] {
  const lines: [Element, string][] = [];
  if (op.op === "topic.upsert") {
    const hint = root.querySelector(`a[data-new-topic][data-page="${op.topic.id}"] [data-hint]`);
    if (hint) lines.push([hint, hint.textContent ?? ""]);
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

/** Puts a value in a schedule control, as the editor reads one ("9", "true", a voice id). */
export function setControl(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (control instanceof HTMLSelectElement) {
    // A voice the page was not built with: listed as the page lists a saved one until the list loads.
    if (![...control.options].some((option) => option.value === value))
      control.append(new Option("Saved voice", value));
    control.value = value;
  } else if (control.type === "radio") control.checked = control.value === value;
  else control.checked = value === "true";
}

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
    if (value !== undefined) setControl(control, value);
  }
  const { removedTopics } = savedTopics(ops);
  // A topic added or renamed since the build: its chip, ticked or not by the scope loop below.
  const list = root.querySelector<HTMLElement>("[data-scope-chips]");
  if (list && overlayChips(list, ops, undefined, true).length > 0) shown = true;
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

// ------------------------------------------------------------------------------- topic chip lists

/**
 * A list of topic chips (a checkbox in a label, the topic's words in its span) with the saved edits
 * laid over it: a removed topic's chip goes, a renamed one says its new name, and a topic the build
 * did not have gets a chip like the others. The list names every topic the build knew in
 * data-built-topics. A chip that goes is disabled too, so the form never sends it.
 *
 * A chip names its topics in data-ids (Create) or data-scope-ids (Daily, Weekly). On Daily and
 * Weekly a chip is a switch, so a chip out of the podcast stays (unticked) and a new topic's chip
 * starts ticked, as a new topic plays; `podcast` says so. Returns the chips it added.
 */
export function overlayChips(
  list: HTMLElement,
  ops: readonly ConfigOp[] = readSaved(),
  scope?: "daily" | "weekly" | "custom",
  podcast = false,
): HTMLInputElement[] {
  const labels = [...list.querySelectorAll<HTMLLabelElement>("label")].filter((label) =>
    label.querySelector("input"),
  );
  const chipOf = (label: HTMLLabelElement) => {
    const input = label.querySelector("input") as HTMLInputElement;
    const ids = (input.dataset.ids ?? input.dataset.scopeIds ?? input.value)
      .split(" ")
      .filter(Boolean);
    return {
      value: podcast ? ids.join(" ") : input.value,
      ids,
      label: label.querySelector("span")?.textContent ?? "",
    };
  };
  const built = new Set((list.dataset.builtTopics ?? "").split(" ").filter(Boolean));
  const changes = savedChips(labels.map(chipOf), built, ops, podcast ? undefined : scope);
  for (const label of labels) {
    const { value } = chipOf(label);
    const input = label.querySelector("input") as HTMLInputElement;
    if (!podcast && changes.hide.has(value)) {
      input.checked = false;
      input.disabled = true;
      label.hidden = true;
    }
    const name = changes.rename.get(value);
    const words = label.querySelector("span");
    if (name && words) words.textContent = name;
  }
  const model = labels.at(-1);
  const added: HTMLInputElement[] = [];
  for (const chip of changes.add) {
    if (!model) break;
    const label = model.cloneNode(true) as HTMLLabelElement;
    const input = label.querySelector("input") as HTMLInputElement;
    if (podcast) input.dataset.scopeIds = chip.ids.join(" ");
    else {
      input.value = chip.value;
      input.dataset.ids = chip.ids.join(" ");
    }
    input.checked = input.defaultChecked = podcast;
    input.disabled = false;
    delete input.dataset.gone;
    label.hidden = false;
    const words = label.querySelector("span");
    if (words) words.textContent = chip.label;
    model.parentElement?.append(label);
    added.push(input);
  }
  return added;
}

/**
 * The Create panel: its starting format, length and voices, and its topic chips, as saved in
 * Settings (schedule.set custom, D69) rather than as built. A control the reader has already
 * changed keeps their choice. True when anything changed.
 */
export function overlayCreate(
  form: HTMLFormElement,
  ops: readonly ConfigOp[] = readSaved(),
): boolean {
  const radios = (name: string) => [
    ...form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`),
  ];
  const builtRadio = (name: string) => radios(name).find((radio) => radio.defaultChecked)?.value;
  const selects = [...form.querySelectorAll<HTMLSelectElement>("select[name]")];
  // The voice list can have been filled already, so the built voice is read from data-saved.
  const builtSelect = (select: HTMLSelectElement) => select.dataset.saved ?? "";
  const baked: FieldValues = {};
  for (const name of ["format", "length"]) {
    const value = builtRadio(name);
    if (value !== undefined) baked[`custom.${name}`] = value;
  }
  for (const select of selects)
    if (select.name === "voice" || select.name === "voice_b")
      baked[`custom.${select.name}`] = builtSelect(select);
  const saved = savedFields(baked, ops);
  let changed = false;
  for (const [key, value] of Object.entries(saved)) {
    const name = key.slice("custom.".length);
    const select = selects.find((each) => each.name === name);
    if (select) {
      if (select.value !== baked[key]) continue;
      setControl(select, value);
      changed = true;
      continue;
    }
    const group = radios(name);
    if (group.find((radio) => radio.checked)?.value !== baked[key]) continue;
    for (const radio of group) setControl(radio, value);
    changed = true;
  }
  const chips = form.querySelector<HTMLElement>("[data-built-topics]");
  if (chips) overlayChips(chips, ops, "custom");
  return changed;
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
export function overlayTopics(
  root: HTMLElement,
  ops = readSaved(),
  store: ConfigReadBody | null = storeRead(),
): boolean {
  if (ops.length === 0 && !store?.sources.length) return false;
  // Rows the store adds come first, so this device's own edits, newer or still on their way (a
  // removal, a switch, a rename), are laid over them as over any built row.
  let shown = drawStored(root, store);
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
    const row = root.querySelector<HTMLElement>(`a.row-action[href="/settings/categories/${id}"]`);
    if (topic) {
      // A removed topic's own page has nothing to show: the list takes its place, in history too.
      topic.setAttribute("data-gone", "");
      globalThis.location?.replace("/settings/categories");
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
  const stored = new Map((store?.sources ?? []).map((source) => [source.id, source]));
  for (const [id, edit] of saved.sources) shown = editSource(root, id, edit, stored) || shown;
  topicChoices(root, saved.topics, saved.removedTopics);
  for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-suggested-add]")) {
    const offer = parseSuggestedAdd(button.dataset.suggestedAdd);
    if (offer && saved.feeds.has(offer.feed_url) && !button.disabled) {
      showAdded(button, offer);
      shown = true;
    }
  }
  shown = addTopics(root, saved.topics) || shown;
  shown = recount(root, ops) || shown;
  shown = recountBlocked(root, ops) || shown;
  if (shown) markSaved(root);
  return shown;
}

/**
 * The page for a topic not built yet (D142): the topic named in the address (`?id=`), taken from what
 * was saved or is on its way, put in place of the stand-ins the page was built with, its suggested
 * sources ranked here as the build ranks them. A topic the build already has, or that was never saved
 * here, opens its own page instead; a removed one, the list. False when the page is being left.
 */
export function fillShell(root: HTMLElement, ops = readSaved()): boolean {
  const id = new URLSearchParams(location.search).get("id") ?? "";
  const saved = savedTopics(ops);
  const topic = saved.topics.get(id);
  if (!topic || (root.dataset.taken ?? "").split(" ").includes(id)) {
    location.replace(
      saved.removedTopics.has(id) || !id
        ? "/settings/categories"
        : `/settings/categories/${encodeURIComponent(id)}`,
    );
    return false;
  }
  const inJson = (text: string): string => JSON.stringify(text).slice(1, -1);
  const swap = (text: string, json: boolean): string =>
    fillShellText(text, {
      id,
      name: json ? inJson(topic.name) : topic.name,
      about: json ? inJson(topic.description) : topic.description,
    });
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (node instanceof Element) {
      for (const attribute of [...node.attributes]) {
        const value = swap(attribute.value, attribute.name.startsWith("data-"));
        if (value !== attribute.value) attribute.value = value;
      }
    } else if (node.nodeValue?.includes("__shell_")) node.nodeValue = swap(node.nodeValue, false);
  }
  document.title = swap(document.title, false);
  // Edit category starts from the saved topic, and sends it whole, emoji and keywords included.
  const trigger = root.querySelector<HTMLElement>("[data-edit-topic]");
  if (trigger) {
    const { name, description, keywords } = topic;
    trigger.dataset.editTopic = JSON.stringify({
      id,
      name,
      description,
      keywords,
      origin: "custom",
    });
    trigger.dataset.topicBase = JSON.stringify({ op: "topic.upsert", topic });
  }
  const pick = root.querySelector<HTMLElement>("[data-change-emoji]");
  if (pick) pick.textContent = topicEmoji({ id, name: topic.name, emoji: topic.emoji });
  root.dataset.taken = `${root.dataset.taken ?? ""} ${id}`;
  root.dataset.filled = "";
  const pane = root.querySelector<HTMLElement>("#topic-pane-sources");
  if (pane)
    void suggestUnder(pane, { id, name: topic.name, description: topic.description }, saved.feeds);
  return true;
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
    const { total } = sourceCounts(spots, page);
    const text = sourcesSummary({ total, never: row.dataset.never !== undefined });
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
  const row = root.querySelector(`a.row-action[href="/settings/categories/${id}"] .settings-label`);
  if (row && row.textContent !== topic.name) {
    row.textContent = topic.name;
    shown = true;
  }
  // A saved emoji, or none (reset to the default), as the build would draw it.
  const emoji = topic.emoji ?? topicEmoji({ id, name: topic.name });
  const mark = root.querySelector(`a.row-action[href="/settings/categories/${id}"] .topic-emoji`);
  if (mark && mark.textContent !== emoji) {
    mark.textContent = emoji;
    shown = true;
  }
  const trigger = root.querySelector<HTMLElement>("[data-edit-topic]");
  if (!byId(root, "[data-topic]", id) || !trigger) return shown;
  // A saved emoji shows on the list's row and on the topic's page, and its next edit keeps it.
  const pick = root.querySelector<HTMLElement>("[data-change-emoji]");
  if (pick && pick.textContent !== emoji) {
    pick.textContent = emoji;
    const base = JSON.parse(trigger.dataset.topicBase ?? "{}");
    const { emoji: _, ...rest } = base.topic ?? {};
    trigger.dataset.topicBase = JSON.stringify({
      ...base,
      topic: topic.emoji ? { ...rest, emoji: topic.emoji } : rest,
    });
    shown = true;
  }
  const facts = JSON.parse(trigger.dataset.editTopic ?? "{}") as Partial<Upsert>;
  if (facts.id !== id || (facts.name === topic.name && facts.description === topic.description))
    return shown;
  const { name, description, keywords } = topic;
  trigger.dataset.editTopic = JSON.stringify({ ...facts, name, description, keywords });
  if (facts.name && facts.name !== name) renameLabels(facts.name, name);
  trigger.setAttribute("aria-label", `Edit category ${name}`);
  const title = document.getElementById("page-title");
  if (title) title.textContent = name;
  pick?.setAttribute("aria-label", `Change emoji for ${name}`);
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

/** How a topic's page names it, outside its title: the tab, menus, dialogs and Add source. */
const NAMED = [
  "{}",
  "Skip to {}",
  "Change emoji for {}",
  "More actions for {}",
  "Edit category {}",
  "Delete category {}",
  "Keep category {}",
  "Add source to {}",
  "{} sources",
  "Delete {}?",
];
const LABELS = ["aria-label", "data-label", "data-label-undo", "data-name", "title"];

/**
 * Every place a topic's page says its old name, by those patterns only, so a source or a sentence
 * that merely contains the name is left as it is.
 */
function renameLabels(was: string, name: string): void {
  const swap = (text: string): string | null => {
    for (const pattern of NAMED)
      if (text === pattern.replace("{}", was)) return pattern.replace("{}", name);
    return null;
  };
  if (document.title.startsWith(`${was}, `))
    document.title = `${name}${document.title.slice(was.length)}`;
  for (const node of document.body.querySelectorAll<HTMLElement>("*")) {
    if (node.closest("li.source-row, template")) continue;
    for (const attribute of LABELS) {
      const value = node.getAttribute(attribute);
      const next = value === null ? null : swap(value);
      if (next !== null) node.setAttribute(attribute, next);
    }
    if (node.childElementCount === 0 && node.textContent) {
      const next = swap(node.textContent.trim());
      if (next !== null) node.textContent = next;
    }
  }
}

/**
 * A topic's page with the config store on (D149): each source the store files here and the build
 * listed nowhere or elsewhere gets its row, first in the list as a just-added one does; one the
 * build listed here and the store files elsewhere goes, as it will at the next build.
 */
function drawStored(root: HTMLElement, store: ConfigReadBody | null): boolean {
  const library = root.querySelector<HTMLElement>("ul[data-library]");
  if (store && library) return drawLibrary(root, library, store.sources);
  const page = root.dataset.page;
  const list = root.querySelector<HTMLElement>("ul[data-sources]:not([data-added])");
  if (!store || page === undefined || !list) return false;
  // The page's own topic, as its built rows name it: a group's home, or the topic itself.
  const home = root.querySelector<HTMLElement>("[data-add-source]")?.dataset.addSource ?? "";
  const topic = {
    id: home,
    name: home ? (document.getElementById("page-title")?.textContent?.trim() ?? "") : "",
  };
  let shown = false;
  for (const source of store.sources) {
    const row = byId(root, "li.source-row", source.id);
    if (source.page !== page) {
      if (row && row.dataset.gone === undefined) {
        row.setAttribute("data-gone", "");
        shown = true;
      }
    } else if (!row) {
      list.prepend(storedSourceRow(source, topic));
      shown = true;
    }
  }
  return shown;
}

/** The name of a page the index lists (a group, a topic, or Other), as its row says it. */
function pageName(root: HTMLElement, page: string): string {
  const row = [...root.querySelectorAll<HTMLElement>("a.row-action[data-page]")].find(
    (each) => each.dataset.page === page,
  );
  return row?.querySelector(".settings-label")?.textContent?.trim() ?? "";
}

/**
 * The index's search list with the config store on (D149): a source the store holds and the build
 * does not gets its row, in its place by name, so the search finds a source added on another device.
 * A row the store files elsewhere says the topic it is on now.
 */
function drawLibrary(
  root: HTMLElement,
  library: HTMLElement,
  sources: readonly StoreSource[],
): boolean {
  let shown = false;
  for (const source of sources) {
    const topic = { id: source.page, name: pageName(root, source.page) };
    const row = byId(root, "li.source-row", source.id);
    if (row) {
      shown = sourceKind(row, undefined, topic.name || "Other") || shown;
      continue;
    }
    const drawn = storedSourceRow(source, topic);
    drawn.querySelector(".source-text")?.append(element("span", "source-meta source-kind"));
    sourceKind(drawn, source.format, topic.name || "Other");
    const after = [...library.querySelectorAll<HTMLElement>("li.source-row")].find(
      (each) => (each.dataset.name ?? "").localeCompare(drawn.dataset.name ?? "", "en") > 0,
    );
    library.insertBefore(drawn, after ?? null);
    shown = true;
  }
  return shown;
}

/** The index row's line under a source: its format and the topic it is on. True when it changed. */
function sourceKind(row: HTMLElement, format?: SourceFormat, topic?: string): boolean {
  const kind = row.querySelector(".source-kind");
  if (!kind) return false;
  const [builtFormat = "", builtTopic = ""] = (kind.textContent ?? "").split(" · ");
  const text = `${format ? FORMAT_LABEL[format] : builtFormat} · ${topic ?? builtTopic}`;
  if (kind.textContent === text) return false;
  kind.textContent = text;
  return true;
}

/**
 * A source's saved edits on its row: a new name, format or lean, and the topic it moves to. A move
 * the config store already holds (`stored`) is where the source is now, not one still to come.
 */
function editSource(
  root: HTMLElement,
  id: string,
  edit: { name?: string; topic_ids?: string[]; format?: SourceFormat; lean?: number | null },
  stored: ReadonlyMap<string, StoreSource> = new Map(),
): boolean {
  const row = byId(root, "li.source-row", id);
  const button = row?.querySelector<HTMLElement>("[data-edit-source]");
  if (!row || !button) return false;
  const facts = JSON.parse(button.dataset.editSource ?? "{}") as {
    name?: string;
    topic_id?: string;
    topic_name?: string;
    format?: SourceFormat;
    lean?: string;
  };
  let shown = false;
  if (edit.name !== undefined && edit.name !== facts.name) {
    facts.name = edit.name;
    row.dataset.name = edit.name.toLowerCase();
    // The search finds it by its new name too.
    row.dataset.text = `${row.dataset.text ?? ""} ${fold(edit.name)}`;
    const name = row.querySelector(".source-name");
    if (name) name.textContent = edit.name;
    button.setAttribute("aria-label", `Edit ${edit.name}`);
    shown = true;
  }
  if (edit.format !== undefined && edit.format !== facts.format) {
    facts.format = edit.format;
    row.dataset.format = edit.format;
    sourceKind(row, edit.format);
    shown = true;
  }
  const lean = edit.lean === null ? "" : edit.lean === undefined ? undefined : String(edit.lean);
  if (lean !== undefined && lean !== facts.lean) {
    facts.lean = lean;
    shown = true;
  }
  const topicId = edit.topic_ids ? (edit.topic_ids[0] ?? "") : undefined;
  // A row drawn from the store is on the page that lists it (drawStored): a move to any topic this
  // page stands for is no move. Only a later one, made here, is still to come.
  const here = (root.dataset.members ?? "").split(" ");
  if (
    topicId !== undefined &&
    topicId !== (facts.topic_id ?? "") &&
    !(row.dataset.stored !== undefined && here.includes(topicId))
  ) {
    const panel = document.querySelector<HTMLTemplateElement>("#topics-panel-template");
    const options = panel?.content.querySelectorAll<HTMLOptionElement>("[data-edit-topic] option");
    const chosen = [...(options ?? [])].find((option) => option.value === topicId);
    facts.topic_id = topicId;
    facts.topic_name = chosen?.text ?? (topicId || "Other");
    // Moved already: the store files it there, so it is on that topic now, with nothing to wait for.
    if (stored.has(id)) {
      button.dataset.editSource = JSON.stringify(facts);
      row.querySelector(".source-note")?.remove();
      sourceKind(row, undefined, facts.topic_name);
      return true;
    }
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

/**
 * The Add and Edit source panels' topic lists, in the panel template and in a panel already open:
 * a topic saved since the build is offered, a renamed one says its new name, a removed one goes.
 */
function topicChoices(
  root: HTMLElement,
  topics: ReadonlyMap<string, Upsert>,
  removed: ReadonlySet<string>,
): void {
  // The topics the build has (data-taken): a built-in one is offered through its group.
  const taken = new Set((root.dataset.taken ?? "").split(" "));
  const template = document.querySelector<HTMLTemplateElement>("#topics-panel-template");
  const selects = [
    ...(template?.content.querySelectorAll<HTMLSelectElement>(
      "select[data-source-topic], select[data-edit-topic]",
    ) ?? []),
    ...document.querySelectorAll<HTMLSelectElement>(
      "select[data-source-topic], select[data-edit-topic]",
    ),
  ];
  for (const select of selects) {
    for (const option of [...select.options]) {
      if (removed.has(option.value)) option.remove();
      const name = topics.get(option.value)?.name;
      if (name && option.text !== name) option.text = name;
    }
    for (const [id, topic] of topics)
      if (!taken.has(id) && ![...select.options].some((option) => option.value === id))
        select.append(new Option(topic.name, id));
  }
}

/**
 * On the list: each topic saved since the build, as a row like the others in its place by name, its
 * link the page that shows a topic not built yet (D142). Its suggested sources are on that page.
 */
function addTopics(root: HTMLElement, topics: Map<string, Upsert>): boolean {
  if (!root.querySelector(".topics-index")) return false;
  const taken = new Set((root.dataset.taken ?? "").split(" "));
  let shown = false;
  for (const [id, topic] of topics) {
    if (taken.has(id)) continue;
    const emoji = topic.emoji ?? topicEmoji({ id, name: topic.name });
    const row = topicRow(root, { id, name: topic.name, emoji }, sourcesSummary({ total: 0 }));
    shown = Boolean(row) || shown;
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
 * The catalogue's feeds that fit a topic not built yet, at the end of `row` (its page's Sources), each with the +
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

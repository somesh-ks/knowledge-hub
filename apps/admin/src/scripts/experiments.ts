/**
 * The Experiments page's switches. The page is drawn from the last deploy's files; this asks the
 * store (api/experiments.ts) for the owner's switches, lays them over it, and writes one when the
 * owner turns a switch or promotes: each asks first (the confirm dialog) and, once done, offers
 * Undo (the toast). A switch changes the next run, never one under way (D249). A switch moves when
 * it is pressed; the change is kept across a reload until the store has it (lib/pendingFlags.ts).
 */

import { sendToast } from "../../../web/src/scripts/toastEvent";
import type { ExperimentAction, FlagRow, HitTotal } from "../lib/experimentsApi";
import { fresh, intended, type PendingMap, parsePending, unsettled } from "../lib/pendingFlags";
import { href } from "../lib/sections";

const API = href("/api/experiments");
const WORDS = { on: "On", shadow: "Shadow", off: "Off", promoted: "Promoted" } as const;
const NOTE_OFFLINE = "The store cannot be reached. Showing the last deploy.";
const PENDING_KEY = "experiments.pending";
/** How often a page holding an unconfirmed change expires it and asks the store again. */
const WATCH_MS = 1500;

const root = document.querySelector<HTMLElement>("[data-experiments]");
const NOTE_DEFAULT = document.querySelector<HTMLElement>("[data-note]")?.textContent ?? "";
const rows = [...document.querySelectorAll<HTMLElement>("[data-experiment][data-built]")];
const flags = new Map<string, FlagRow>();
/** What each experiment in shadow would have added this week, as the store counted it. */
const hits = new Map<string, HitTotal>();
/** Changes pressed and not yet in the store, by experiment; kept in the tab across a reload. */
let intents: PendingMap = loadIntents();
function loadIntents(): PendingMap {
  try {
    return parsePending(sessionStorage.getItem(PENDING_KEY));
  } catch {
    return {};
  }
}
function saveIntents(): void {
  try {
    if (Object.keys(intents).length === 0) sessionStorage.removeItem(PENDING_KEY);
    else sessionStorage.setItem(PENDING_KEY, JSON.stringify(intents));
  } catch {
    // Private mode: the change still goes to the store, it just is not kept across a reload.
  }
}
/** Writes not yet answered, by experiment: Promote waits for them. */
const pending = new Map<string, number>();
const count = (id: string, by: number): void => {
  pending.set(id, (pending.get(id) ?? 0) + by);
};

const part = <T extends Element>(row: ParentNode, selector: string): T | null =>
  row.querySelector<T>(selector);

/** The state word, and for a shadow what it would have added this week: "+0" says it ran and found nothing. */
function shadowLine(word: string, hit: HitTotal | undefined): string {
  if (!hit) return word;
  return `${word} · +${hit.stories} ${hit.stories === 1 ? "story" : "stories"} this week`;
}

/** What the row is now: the change just pressed, else the store's switch, else the file the page was built from. */
function render(row: HTMLElement): void {
  const id = row.dataset.experiment ?? "";
  const flag = intents[id]?.flag ?? flags.get(id);
  const on = flag ? flag.enabled : row.dataset.built === "on";
  const promoted = flag?.promoted_at != null;
  const word = promoted
    ? WORDS.promoted
    : on
      ? WORDS.on
      : row.dataset.rest === "shadow"
        ? WORDS.shadow
        : WORDS.off;
  const label = part<HTMLElement>(row, "[data-state]");
  const control = part<HTMLInputElement>(row, "[data-switch]");
  const promote = part<HTMLButtonElement>(row, "[data-promote]");
  if (!control || !promote || !label) return;
  label.textContent =
    word === WORDS.shadow ? shadowLine(word, hits.get(row.dataset.experiment ?? "")) : word;
  const waiting = (pending.get(row.dataset.experiment ?? "") ?? 0) > 0;
  control.checked = on;
  control.disabled = promoted;
  // Promote waits, unseen but in its place, in a row that cannot use it (admin.css).
  promote.disabled = on === false || promoted || waiting;
}

function renderAll(): void {
  for (const row of rows) render(row);
}

/**
 * Lets go of changes the store has or that ran out of time, but not while a write of theirs is under
 * way (and still fresh). `stored` is what a read of the store answered; pass none to only expire.
 */
function reconcile(stored: FlagRow[]): void {
  const now = Date.now();
  const kept = unsettled(stored, intents, now);
  for (const [id, held] of Object.entries(intents)) {
    if ((pending.get(id) ?? 0) > 0 && fresh(held, now)) kept[id] = held;
  }
  intents = kept;
  saveIntents();
}

function adopt(body: { flags?: FlagRow[] }): void {
  flags.clear();
  for (const flag of body.flags ?? []) flags.set(flag.id, flag);
}

/** A read of the store: the only answer that settles a change, since the next read may be an older copy. */
function take(body: { flags?: FlagRow[] }): void {
  adopt(body);
  reconcile([...flags.values()]);
}

async function ask(init?: { id: string; action: ExperimentAction }): Promise<Response> {
  return fetch(API, {
    method: init ? "POST" : "GET",
    // A reload right after a press must not cancel the write on its way.
    keepalive: init !== undefined,
    headers: init ? { "content-type": "application/json" } : undefined,
    body: init ? JSON.stringify(init) : undefined,
  });
}

/**
 * Writes one switch; true when the store has it. The switch moves at once; a failure puts it back
 * and says so in a toast. Writes go one at a time, in the order asked: each answer is every switch
 * as the store has it, so an older answer must not land after a newer one, and an Undo made while
 * its write is under way runs after it.
 */
let queue: Promise<unknown> = Promise.resolve();
/** Set as the page goes: the browser fails a request in flight then, though keepalive lets it finish. */
let leaving = false;
addEventListener("pagehide", () => {
  leaving = true;
});
// A page restored from the back/forward cache is live again.
addEventListener("pageshow", () => {
  leaving = false;
});
/** Counts presses, so an answer to a question asked before the latest one is not taken for the store's. */
let generation = 0;
function write(id: string, action: ExperimentAction): Promise<boolean> {
  const now = Date.now();
  const row = rows.find((candidate) => candidate.dataset.experiment === id);
  const current = intents[id]?.flag ??
    flags.get(id) ?? { id, enabled: row?.dataset.built === "on", promoted_at: null };
  intents[id] = { flag: intended(current, action, now), at: now };
  saveIntents();
  generation += 1;
  count(id, 1);
  renderAll();
  watch();
  const run = queue.then(() => send(id, action));
  queue = run;
  return run;
}

/** One write and its answer; never rejects. */
async function send(id: string, action: ExperimentAction): Promise<boolean> {
  let saved = false;
  try {
    const response = await ask({ id, action });
    const body = (await response.json()) as { flags?: FlagRow[]; error?: string };
    // A write's answer does not settle the change: the next read may still be an old copy (the
    // worker's, a cache's), so only a read that shows it does (take).
    if (body.flags) adopt(body);
    if (response.ok) {
      saved = true;
      return true;
    }
    toast(
      body.error === "promoted" ? "A promoted experiment stays on." : "Could not save. Try again.",
      "error",
    );
  } catch {
    if (!leaving) toast("Could not save. Try again.", "error");
  } finally {
    count(id, -1);
    // A refused or failed write puts the switch back, unless a later press for it is waiting. One
    // the store took stays until the store's own answer matches it (watch, take).
    // A page that is going keeps its change for the next one to show.
    if (!leaving) {
      if (!saved && (pending.get(id) ?? 0) === 0) delete intents[id];
      saveIntents();
      renderAll();
    }
  }
  return false;
}

function toast(message: string, kind?: "error", undo?: () => void): void {
  sendToast({ message, kind, actionLabel: undo ? "Undo" : undefined, onAction: undo });
}

const dialog = document.querySelector<HTMLDialogElement>("[data-confirm]");

/** The confirm dialog: resolves true on the confirm button, false on Cancel, Esc or the backdrop. */
function confirm(title: string, lede: string, go: string): Promise<boolean> {
  if (!dialog) return Promise.resolve(false);
  const set = (selector: string, text: string): void => {
    const element = part<HTMLElement>(dialog, selector);
    if (element) element.textContent = text;
  };
  set("[data-confirm-title]", title);
  set("[data-confirm-lede]", lede);
  set("[data-confirm-go]", go);
  return new Promise((resolve) => {
    const finish = (answer: boolean): void => {
      dialog.removeEventListener("click", onClick);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(answer);
    };
    const onClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-confirm-go]")) finish(true);
      else if (target.closest("[data-confirm-cancel]") || target === dialog) finish(false);
    };
    const onClose = (): void => finish(false);
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

const nameOf = (row: HTMLElement): string =>
  part<HTMLElement>(row, ".settings-label")?.textContent?.trim() ?? "";

type Change = "on" | "off" | "promote";

/** What each change asks, and says once it is made; Undo is the change that takes it back. */
const CHANGES: Record<
  Change,
  { ask: string; lede: string; go: string; done: string; undo: ExperimentAction }
> = {
  on: {
    ask: "Turn on",
    lede: "It takes effect from the next run.",
    go: "Turn on",
    done: "on",
    undo: "off",
  },
  off: {
    ask: "Turn off",
    lede: "It stops from the next run.",
    go: "Turn off",
    done: "off",
    undo: "on",
  },
  promote: {
    ask: "Promote",
    lede: "It becomes a feature and stays on.",
    go: "Promote",
    done: "promoted",
    undo: "unpromote",
  },
};

/** Asks, writes, and offers Undo. */
async function change(row: HTMLElement, action: Change): Promise<void> {
  const id = row.dataset.experiment ?? "";
  const name = nameOf(row);
  const copy = CHANGES[action];
  if (!(await confirm(`${copy.ask} ${name}?`, copy.lede, copy.go))) return;
  if (!(await write(id, action))) return;
  toast(`${name} ${copy.done}`, undefined, () => {
    void write(id, copy.undo);
  });
}

root?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLElement>("[data-experiment]");
  if (!row) return;
  const control = target.closest<HTMLInputElement>("[data-switch]");
  if (control) {
    // The switch moves once the store has the change, not when it is pressed.
    event.preventDefault();
    void change(row, control.checked ? "on" : "off");
  } else if (target.closest("[data-promote]")) void change(row, "promote");
});

/** Without the store the page stays what the last deploy built, and its controls stay still. */
async function start(): Promise<void> {
  const note = document.querySelector<HTMLElement>("[data-note]");
  try {
    const response = await ask();
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as { flags?: FlagRow[]; hits?: Record<string, HitTotal> };
    take(body);
    for (const [id, total] of Object.entries(body.hits ?? {})) hits.set(id, total);
  } catch {
    if (note) note.textContent = NOTE_OFFLINE;
    renderAll();
    ready();
    watch();
    return;
  }
  renderAll();
  ready();
  watch();
}

let watching = false;

/**
 * While a change is unconfirmed, expire it when its wait runs out, which never depends on the
 * network, and (with no write of this page under way) ask the store again until it has the change.
 */
function watch(): void {
  if (watching || Object.keys(intents).length === 0) return;
  watching = true;
  const tick = (): void => {
    reconcile([]);
    renderAll();
    if (Object.keys(intents).length === 0) {
      watching = false;
      return;
    }
    if ([...pending.values()].every((n) => n === 0)) void recheck();
    setTimeout(tick, WATCH_MS);
  };
  setTimeout(tick, WATCH_MS);
}

/** One question at a time: a slow answer must not land after a newer one. */
let rechecking = false;

async function recheck(): Promise<void> {
  if (rechecking) return;
  rechecking = true;
  const asked = generation;
  try {
    const response = await ask();
    const body = (await response.json()) as { flags?: FlagRow[] };
    if (!response.ok || asked !== generation) return;
    take(body);
    const note = document.querySelector<HTMLElement>("[data-note]");
    if (note) note.textContent = NOTE_DEFAULT;
    renderAll();
  } catch {
    // Still unreachable: the wait runs out on its own.
  } finally {
    rechecking = false;
  }
}

/** The switches are neutral tracks until their values are known (settings.css, data-ready). */
const ready = (): void => {
  if (root) root.dataset.ready = "";
};

void start();

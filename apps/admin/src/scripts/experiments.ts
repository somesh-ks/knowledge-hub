/**
 * The Experiments page's switches. The page is drawn from the last deploy's files; this asks the
 * store (api/experiments.ts) for the owner's switches, lays them over it, and writes one when the
 * owner turns a switch or promotes: each asks first (the confirm dialog) and, once done, offers
 * Undo (the toast). A switch changes the next run, never one under way (D249).
 */

import { sendToast } from "../../../web/src/scripts/toastEvent";
import type { ExperimentAction, FlagRow } from "../lib/experimentsApi";
import { href } from "../lib/sections";

const API = href("/api/experiments");
const WORDS = { on: "On", shadow: "Shadow", off: "Off", promoted: "Promoted" } as const;
const NOTE_OFFLINE = "The store cannot be reached. Showing the last deploy.";

const root = document.querySelector<HTMLElement>("[data-experiments]");
const rows = [...document.querySelectorAll<HTMLElement>("[data-experiment][data-built]")];
const flags = new Map<string, FlagRow>();

const part = <T extends Element>(row: ParentNode, selector: string): T | null =>
  row.querySelector<T>(selector);

/** What the row is now: the store's switch where it has one, else the file the page was built from. */
function render(row: HTMLElement): void {
  const flag = flags.get(row.dataset.experiment ?? "");
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
  label.textContent = word;
  control.checked = on;
  control.disabled = promoted;
  // Promote waits, unseen but in its place, in a row that cannot use it (admin.css).
  promote.disabled = on === false || promoted;
}

function renderAll(): void {
  for (const row of rows) render(row);
}

function take(body: { flags?: FlagRow[] }): void {
  flags.clear();
  for (const flag of body.flags ?? []) flags.set(flag.id, flag);
}

async function ask(init?: { id: string; action: ExperimentAction }): Promise<Response> {
  return fetch(API, {
    method: init ? "POST" : "GET",
    headers: init ? { "content-type": "application/json" } : undefined,
    body: init ? JSON.stringify(init) : undefined,
  });
}

/** Writes one switch; true when the store has it. A failure says so in a toast and changes nothing. */
async function write(id: string, action: ExperimentAction): Promise<boolean> {
  try {
    const response = await ask({ id, action });
    const body = (await response.json()) as { flags?: FlagRow[]; error?: string };
    if (body.flags) {
      take(body);
      renderAll();
    }
    if (response.ok) return true;
    toast(
      body.error === "promoted" ? "A promoted experiment stays on." : "Could not save. Try again.",
      "error",
    );
  } catch {
    toast("Could not save. Try again.", "error");
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
    take((await response.json()) as { flags?: FlagRow[] });
  } catch {
    if (note) note.textContent = NOTE_OFFLINE;
    ready();
    return;
  }
  renderAll();
  ready();
}

/** The switches are neutral tracks until their values are known (settings.css, data-ready). */
const ready = (): void => {
  if (root) root.dataset.ready = "";
};

void start();

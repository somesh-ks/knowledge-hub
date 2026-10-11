/**
 * Sending the pending edits, on their own. autosave.ts loads this with the first change and calls
 * `flush` once the controls have been still for a moment: one request carries every pending edit
 * (the server takes up to eight), and a change made while it is on its way goes in the next one.
 * Nothing here is needed to read or edit a page, so it stays out of the first-load budget.
 */
import { OPEN_PASSPHRASE, PASSPHRASE_REQUIRED } from "../lib/access";
import { SAVED_KEY } from "../lib/savedKey";
import { addSaved, parseSaved } from "../lib/savedOverlay";
import type { ConfigOp, ConfigResponse } from "../types/contracts";

const KEY = "dispatch:narrate-passphrase";

export const SAVING = "Saving";
export const SAVED = "Saved. Live in about a minute.";

/** Shown when the edit went through but the site could not change the briefing time. */
export const TIME_REFUSED =
  "Saved, except the time: the site's GitHub token needs permission to write repository variables.";

/** What a topic or a source added on the page says once it is in the repository. */
export const ADDED = "Added. It appears after the next build.";

const REASONS: Record<number, string> = {
  400: "That change was not accepted.",
  401: PASSPHRASE_REQUIRED ? "That passphrase is not right." : "Saving was refused.",
  429: "There were too many edits in a row.",
  503: "Saving is not available right now.",
};

/** What a refusal means. The change is still on the page, and Retry sends it again. */
export function failureText(status: number): string {
  return `${REASONS[status] ?? "The site could not be reached."} Not saved yet.`;
}

/** The most edits one request may carry (MAX_OPS in server/configEdit.ts). */
export const MAX_OPS = 8;

/** One pending change: the edit, the control (or added row) behind it, and what the control now holds. */
export interface Pending {
  op: ConfigOp;
  /** Edits that go in the same request, after `op`: the sources chosen for a new topic. */
  with?: ConfigOp[];
  el: HTMLElement;
  now: string;
}

/** What the toast shows: a removal that can still be undone, a save on its way, its outcome. */
export type SaveState = "undo" | "saving" | "done" | "error";

export interface SaveContext {
  changes: Map<string, Pending>;
  show(message: string, state: SaveState): void;
  /** The passphrase dialog, on a site that asks for one (lib/access.ts). */
  dialog: HTMLDialogElement | null;
  /** After a request went through: read the controls again against their new starting point. */
  settled?(): void;
}

interface Step {
  op: ConfigOp;
  ops?: ConfigOp[];
  keys: string[];
}

/**
 * The steps that settle the pending changes. Every slider change goes in one step, after the rest,
 * and a removal goes last so nothing is edited after it is gone.
 */
export function buildQueue(changes: ReadonlyMap<string, Pending>): Step[] {
  const weights: Record<string, number> = {};
  const weightKeys: string[] = [];
  const edits: Step[] = [];
  const removals: Step[] = [];
  for (const [key, { op, el, with: extra }] of changes) {
    if (op.op === "topic.upsert") {
      // The switch was built with the slider's value from the page load, which may have moved since.
      const slider = el
        .closest("li, [data-topic]")
        ?.querySelector<HTMLInputElement>("[data-weight]");
      if (slider) op.topic.weight = Number(slider.value);
    }
    if (op.op === "weights.set") {
      Object.assign(weights, op.weights);
      weightKeys.push(key);
    } else {
      (op.op.endsWith(".remove") ? removals : edits).push({
        op,
        ...(extra && extra.length > 0 ? { ops: [op, ...extra] } : {}),
        keys: [key],
      });
    }
  }
  if (weightKeys.length > 0) edits.push({ op: { op: "weights.set", weights }, keys: weightKeys });
  return [...edits, ...removals];
}

/** One request: the edits it carries, and the pending changes it settles. */
export interface Batch {
  ops: ConfigOp[];
  sent: [string, Pending][];
}

/**
 * The steps packed into as few requests as the server allows, in their order. A step never splits:
 * an edit and the sources chosen with it go together.
 */
export function pack(steps: readonly Step[], changes: ReadonlyMap<string, Pending>): Batch[] {
  const batches: Batch[] = [];
  let current: Batch = { ops: [], sent: [] };
  for (const step of steps) {
    const ops = step.ops ?? [step.op];
    if (current.ops.length > 0 && current.ops.length + ops.length > MAX_OPS) {
      batches.push(current);
      current = { ops: [], sent: [] };
    }
    current.ops.push(...ops);
    for (const key of step.keys) {
      const pending = changes.get(key);
      if (pending) current.sent.push([key, pending]);
    }
  }
  if (current.ops.length > 0) batches.push(current);
  return batches;
}

/**
 * Focus on a row about to be hidden moves to what takes its place: on a removed topic's page, the
 * line that says so; otherwise the next row's control, else the one before, else the page's title.
 */
function rehome(gone: Element): void {
  const page = gone.ownerDocument;
  const focused = page?.activeElement;
  if (!focused || !gone.contains(focused)) return;
  const near = (from: Element | null, back: boolean): HTMLElement | null => {
    for (let row = from; row; row = back ? row.previousElementSibling : row.nextElementSibling) {
      const control = row.hasAttribute("data-gone")
        ? null
        : row.querySelector<HTMLElement>("button, input");
      if (control) return control;
    }
    return null;
  };
  const target =
    gone.querySelector<HTMLElement>(".topic-gone") ??
    near(gone.nextElementSibling, false) ??
    near(gone.previousElementSibling, true) ??
    page.querySelector<HTMLElement>("#page-title");
  target?.focus();
}

/**
 * Marks what a request saved. A control takes the value it was sent with as its new starting point.
 * A change made while the request was on its way is a newer entry under the same key, so it stays
 * pending and goes next.
 */
export function settle(batch: Batch, changes: Map<string, Pending>): void {
  for (const [key, pending] of batch.sent) {
    const { el, now } = pending;
    if (el.matches("li")) {
      // A topic added on the page: it stays listed, saved, until the build shows it in place.
      const note = el.querySelector(".manage-quiet");
      if (note) note.textContent = ADDED;
      el.querySelector("[data-act=cancel]")?.remove();
    } else if (el.matches(".source-note")) el.textContent = ADDED;
    else {
      if (el.matches("[data-remove]")) {
        const row = el.closest("li") ?? el.closest("[data-topic]");
        if (row) rehome(row);
        row?.setAttribute("data-gone", "");
      } else if (el.matches("[data-suggest]")) (el as HTMLButtonElement).disabled = true;
      // Every control, a pressed remove button included, now starts from what was saved: read again,
      // it is no longer a change.
      el.dataset.was = now;
    }
    if (changes.get(key) === pending) changes.delete(key);
  }
}

/**
 * Keeps a request that went through, so a settings page opened before the build shows what was
 * saved (lib/savedOverlay.ts, scripts/savedView.ts).
 */
export function remember(ops: readonly ConfigOp[], now = Date.now()): void {
  try {
    const entries = addSaved(parseSaved(localStorage.getItem(SAVED_KEY), now), ops, now);
    if (entries.length > 0) localStorage.setItem(SAVED_KEY, JSON.stringify(entries));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    // Storage is refused: the page shows the old value until the build, as it did before.
  }
}

/**
 * The server takes one edit every ten seconds (CONFIG_COOLDOWN_MS in server/configEdit.ts), counted
 * from when the last one started, and refuses the next one sooner with a 429. A little is added for
 * the time a request takes to get there.
 */
export const GAP_MS = 10_000 + 250;

/**
 * How long to hold the next request, after the last one went through at `last` (0 for none). What
 * changes meanwhile waits and goes in that one request, instead of being sent, refused and sent again.
 */
export function gapLeft(last: number, now: number): number {
  return last === 0 ? 0 : Math.max(0, Math.min(GAP_MS, last + GAP_MS - now));
}

let passphrase: string | null = null;
/** When the last request went through, by this page's clock; 0 before the first. */
let lastSent = 0;
/** True while a flush runs. A second call returns at once: the running one sends what is waiting. */
let busy = false;

/** Where the passphrase is kept between visits. Passing null forgets it. */
function memory(value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(KEY);
    if (value === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch {
    // Storage is refused: the passphrase still carries this visit.
  }
  return null;
}

interface Answer {
  status: number;
  /** For a 429: how long the server asks to wait. */
  wait: number;
  timeRefused: boolean;
}

/** One request. `keepalive` lets it finish when the page is closed right after a change. */
async function post(ops: ConfigOp[], given: string): Promise<Answer> {
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: given, op: ops.length === 1 ? ops[0] : ops }),
      keepalive: true,
    });
    const body = (await response.json().catch(() => ({}))) as Partial<ConfigResponse>;
    const status = body.status ?? response.status;
    return {
      status,
      wait: status === 429 ? ("retry_after_s" in body && body.retry_after_s) || 10 : 0,
      timeRefused: status === 202 && "time_changed" in body && body.time_changed === false,
    };
  } catch {
    return { status: 0, wait: 0, timeRefused: false };
  }
}

/** How many times a run waits out the server's ten seconds between edits before it gives up. */
const MAX_WAITS = 6;

/**
 * Sends what is pending until nothing is, then says how it went. The server allows an edit every
 * ten seconds: a request inside that gap is held until it ends (gapLeft), without Saving, and a 429
 * all the same waits as long as it asks; either way the changes made during the wait ride along.
 * Asks for the passphrase once where one is required.
 */
export async function flush(
  context: SaveContext,
  given = PASSPHRASE_REQUIRED ? (passphrase ?? memory()) : OPEN_PASSPHRASE,
): Promise<void> {
  const { changes, show, dialog } = context;
  if (busy || changes.size === 0) return;
  if (!given) {
    if (!dialog) return;
    const field = dialog.querySelector<HTMLInputElement>("[data-passphrase]") as HTMLInputElement;
    const remember = dialog.querySelector<HTMLInputElement>("[data-remember]") as HTMLInputElement;
    dialog.returnValue = "";
    dialog.addEventListener(
      "close",
      () => {
        const value = dialog.returnValue === "ok" ? field.value : "";
        field.value = "";
        if (!value) return;
        if (remember.checked) memory(value);
        void flush(context, value);
      },
      { once: true },
    );
    dialog.showModal();
    return;
  }

  passphrase = given;
  busy = true;
  let failure = "";
  let timeRefused = false;
  let waits = 0;
  /** The last request that went through. The same edits twice in a row would be a loop, not a change. */
  let last = "";
  /** Whether this run sent anything: a run that only waited, for changes then put back, says nothing. */
  let sent = false;
  try {
    while (changes.size > 0) {
      // Inside the server's gap after the last request, wait it out first, quietly: nothing is on
      // its way yet, and whatever changes meanwhile goes in the one request sent after it.
      const hold = gapLeft(lastSent, Date.now());
      if (hold > 0) await new Promise((resolve) => setTimeout(resolve, hold));
      const [batch] = pack(buildQueue(changes), changes);
      if (!batch || JSON.stringify(batch.ops) === last) break;
      sent = true;
      show(SAVING, "saving");
      const answer = await post(batch.ops, given);
      if (answer.status === 429 && waits < MAX_WAITS) {
        waits += 1;
        await new Promise((resolve) => setTimeout(resolve, answer.wait * 1000 + 250));
        continue;
      }
      if (answer.status !== 202) {
        if (answer.status === 401) {
          memory(null);
          passphrase = null;
        }
        failure = failureText(answer.status);
        break;
      }
      timeRefused ||= answer.timeRefused;
      lastSent = Date.now();
      remember(batch.ops, lastSent);
      last = JSON.stringify(batch.ops);
      settle(batch, changes);
      context.settled?.();
    }
  } finally {
    busy = false;
  }
  if (!sent && !failure) return;
  if (failure) {
    show(failure, "error");
    // The interface sound for an outcome the screen already states (see scripts/uiSound.ts). A save
    // that went through makes none: it happens on its own after every change.
    document.dispatchEvent(new CustomEvent("dispatch:sound", { detail: "failure" }));
  } else show(timeRefused ? TIME_REFUSED : SAVED, "done");
}

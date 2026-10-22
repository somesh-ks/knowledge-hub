/**
 * Sending the pending edits, on their own. autosave.ts loads this with the first change and calls
 * `flush` once the controls have been still for a moment: one request carries every pending edit
 * (the server takes up to eight), and a change made while it is on its way goes in the next one.
 * Nothing here is needed to read or edit a page, so it stays out of the first-load budget.
 */
import { OPEN_PASSPHRASE, PASSPHRASE_REQUIRED } from "../lib/access";
import { isSiteAnswer, withErrorRef } from "../lib/errorRef";
import { SAVED_KEY } from "../lib/savedKey";
import { addSaved, parseSaved, withPending } from "../lib/savedOverlay";
import { weightOf } from "../lib/weightStops";
import type { ConfigOp, ConfigResponse } from "../types/contracts";
import { sendToast } from "./toastEvent";

const KEY = "dispatch:narrate-passphrase";

export const SAVING = "Saving";
/** Spoken, never shown: a save that went through needs no toast, the control already shows it. */
export const SAVED = "Saved.";

/** Shown when the edit went through but the site could not change the briefing time. */
export const TIME_REFUSED = "Saved, except the time, which could not be changed.";

/** What a source added on the page says once it is in the repository. */
export const ADDED_SOURCE = "Added. Read from the next update.";

const REASONS: Record<number, string> = {
  0: "Couldn't reach the site.",
  400: "The server turned that change down.",
  401: PASSPHRASE_REQUIRED
    ? "That passphrase is not right."
    : "The server's passphrase setting does not match this site's.",
  429: "There were too many edits in a row.",
  409: "Another device changed this first. Reload to see it.",
  503: "The server ran into a problem.",
};

/**
 * What a refusal means. The change is still on the page, and Retry sends it again. A status with no
 * reason of its own (a 500, say) is a plain failure: only status 0, no answer at all, is the site
 * not being reached.
 */
export function failureText(status: number, body?: unknown): string {
  // A server failure's reference (lib/errorRef.ts) finds the real error in the function logs; a 5xx
  // that is not the site's own answer is the function crashing before it could save anything.
  if (status >= 500 && body !== undefined && !isSiteAnswer(body)) {
    return "The server crashed before it could answer. Not saved yet.";
  }
  const reason = REASONS[status];
  return withErrorRef(reason ? `${reason} Not saved yet.` : "Saving failed on the server.", body);
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
  /** Refused or not sent: kept for Retry on this page, but not a change that is on its way. */
  failed?: boolean;
  /** A control that shows its own outcome: told when its request was refused or did not go. */
  fail?: () => void;
  /** And when it was saved, whether by its own request or by a retry. */
  done?: () => void;
  /**
   * Settles once the edit is final: a new topic waits for Jev's emoji (D142). The page already shows
   * it; only its request waits, and the edits made meanwhile go with it.
   */
  ready?: Promise<void>;
}

/**
 * What the toast shows: a removal that can still be undone, an outcome to read ("done"), a failure.
 * A save on its way ("saving") and one that went through ("saved") show nothing; the second is spoken.
 */
export type SaveState = "undo" | "saving" | "saved" | "done" | "error";

export interface SaveContext {
  changes: Map<string, Pending>;
  show(message: string, state: SaveState): void;
  /** The passphrase dialog, on a site that asks for one (lib/access.ts). */
  dialog: HTMLDialogElement | null;
  /** After a request went through: read the controls again against their new starting point. */
  settled?(): void;
  /**
   * The page was left (a same-document swap) with changes still waiting: they go all the same, and
   * until they do the next page shows them from storage, marked pending (keepWaiting).
   */
  left?: boolean;
  /** Whether its page is still on screen: a tab hidden and shown again was not left after all. */
  here?(): boolean;
  /** The page it was left on, by its title and address: named when what it held is lost (tellLost). */
  from?: { name: string; path: string };
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
  /** Every type slider goes in one mix.set. */
  const mix: Record<string, number> = {};
  const mixKeys: string[] = [];
  const edits: Step[] = [];
  /** A topic's perspective goes in one topic.mix. */
  const mixes = new Map<string, Step>();
  const removals: Step[] = [];
  for (const [key, { op, el, with: extra }] of changes) {
    if (op.op === "topic.upsert") {
      // The switch was built with the slider's value from the page load, which may have moved since.
      const slider = el
        .closest("li, [data-topic]")
        ?.querySelector<HTMLInputElement>("[data-weight]");
      if (slider) op.topic.weight = weightOf(slider);
    }
    if (op.op === "topic.mix") {
      const step = mixes.get(op.id);
      if (step && step.op.op === "topic.mix") {
        step.op.perspective = op.perspective;
        step.keys.push(key);
      } else {
        const joined: Step = { op: { ...op }, keys: [key] };
        mixes.set(op.id, joined);
        edits.push(joined);
      }
    } else if (op.op === "mix.set") {
      Object.assign(mix, op.format_mix);
      mixKeys.push(key);
    } else if (op.op === "weights.set") {
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
  if (mixKeys.length > 0) edits.push({ op: { op: "mix.set", format_mix: mix }, keys: mixKeys });
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
    pending.done?.();
    if (el.matches(".source-note, .source-announce")) el.textContent = ADDED_SOURCE;
    // A topic added on the list is a row like the others already (D142): nothing more to say.
    else if (!el.matches("a[data-new-topic]")) {
      if (el.matches("[data-remove]")) {
        const row = el.closest("li") ?? el.closest("[data-topic]");
        if (row) rehome(row);
        row?.setAttribute("data-gone", "");
        // A topic's own page has nothing left to show once the topic is gone: back to the list,
        // which leaves its row out (savedView.ts), rather than an empty page with only Back. It takes
        // the dead page's place in history, so Back from the list does not return to it; a page
        // already left stays left.
        if (pending.op.op === "topic.remove" && !el.closest("li") && el.isConnected)
          globalThis.location?.replace("/settings/topics");
      } else if (el.matches("[data-suggest]")) (el as HTMLButtonElement).disabled = true;
      // Every control, a pressed remove button included, now starts from what was saved: read again,
      // it is no longer a change.
      el.dataset.was = now;
    }
    if (changes.get(key) === pending) changes.delete(key);
  }
}

/**
 * Pages left with changes still waiting, whose runs have not ended: what they hold is shown to the
 * page opened next, marked pending, until each run ends (keepWaiting, flush).
 */
const leftRuns = new Set<SaveContext>();

/** Every edit the left pages' runs still hold, oldest page first. */
function heldOps(): ConfigOp[] {
  return [...leftRuns].flatMap((context) => waitingOps(context.changes));
}

/**
 * Keeps a request that went through, so a settings page opened before the build shows what was
 * saved (lib/savedOverlay.ts, scripts/savedView.ts), and what the left pages' runs still hold.
 */
export function remember(
  ops: readonly ConfigOp[],
  now = Date.now(),
  waiting: readonly ConfigOp[] = heldOps(),
  stored?: number,
): void {
  try {
    const saved = addSaved(parseSaved(localStorage.getItem(SAVED_KEY), now), ops, now, stored);
    const entries = waiting.length > 0 ? withPending(saved, waiting, now) : saved;
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

/** Every edit still waiting in `changes`, in the order it will go. */
function waitingOps(changes: ReadonlyMap<string, Pending>): ConfigOp[] {
  // A refused change waits for Retry on its page, not for a request: the next page must not show it
  // as saved.
  const going = new Map([...changes].filter(([, pending]) => !pending.failed));
  return pack(buildQueue(going), going).flatMap((batch) => batch.ops);
}

/**
 * The page is being left with changes still waiting (the run holding them out of the server's gap
 * survives a same-document swap): keep them, marked pending, so the page opened next shows them
 * rather than the old values, until the request that carries them goes or fails.
 */
export function keepWaiting(context: SaveContext, now = Date.now()): void {
  if (context.changes.size === 0) return;
  context.left = true;
  context.from ??= {
    name: globalThis.document?.querySelector?.("#page-title")?.textContent?.trim() ?? "",
    path: globalThis.location?.pathname ?? "",
  };
  leftRuns.add(context);
  remember([], now);
}

/** What the page open now hears when a left page's run ends (HELD_EVENT, on the document). */
export interface Held {
  /** Everything the run held went through. */
  ok: boolean;
  /** What the refusal was ("" when ok), as the toast says it. */
  failure: string;
  /** The changes it could not save. The page open now takes them as its own (adopt). */
  lost: Pending[];
  /** A page took them: its toast says so, with Retry. */
  claimed: boolean;
}

/** Told on the document when a left page's run ends (savedView.ts, settingsSaved.ts, autosave.ts). */
export const HELD_EVENT = "dispatch:held";

/** Lost changes no page has taken yet: they wait for the page open now, until it is left. */
let unclaimed: { held: Held[]; entries: [string, Pending][] } | null = null;
let heldCount = 0;

/**
 * The page open now takes the changes a left page's run could not save: they wait in its own
 * changes, refused, ahead of its own (they are older), so its toast says what went wrong with Retry,
 * and Retry or its next change sends them. A page that is itself being left takes nothing.
 */
export function adopt(into: SaveContext): void {
  if (!unclaimed || into.left) return;
  const { held, entries } = unclaimed;
  unclaimed = null;
  for (const each of held) each.claimed = true;
  const own = [...into.changes];
  into.changes.clear();
  for (const [key, pending] of [...entries, ...own]) into.changes.set(key, pending);
  try {
    into.show(held[held.length - 1]?.failure ?? "", "error");
  } catch {
    // The page is gone after all: its next change would still have sent them.
  }
}

/**
 * A left page's run has ended. Nothing it held is on its way any more, so the next page shows none
 * of it as pending; what it could not save waits for the page open now to take it (adopt), and that
 * page hears how the run went.
 */
function endLeft(context: SaveContext, failure: string): void {
  if (!leftRuns.delete(context)) return;
  remember([]);
  // Hidden, not left (the tab was switched away and back): its own toast says how it went, and a
  // refused change stays on it for Retry.
  if (context.here?.()) {
    context.left = false;
    return;
  }
  const entries = failure
    ? [...context.changes].map(([key, pending]): [string, Pending] => {
        pending.failed = true;
        heldCount += 1;
        return [`held${heldCount}:${key}`, pending];
      })
    : [];
  context.changes.clear();
  const held: Held = {
    ok: !failure,
    failure,
    lost: entries.map(([, pending]) => pending),
    claimed: false,
  };
  if (entries.length > 0)
    unclaimed = {
      held: [...(unclaimed?.held ?? []), held],
      entries: [...(unclaimed?.entries ?? []), ...entries],
    };
  globalThis.document?.dispatchEvent(new CustomEvent(HELD_EVENT, { detail: held }));
  // Once the page open now has heard it (a settings page takes it a few microtasks later).
  if (entries.length > 0) setTimeout(() => tellLost(held, context.from), 0);
}

/** What the app's toast says when a lost change has no settings page to take it. */
export function lostText(name = ""): string {
  return name ? `Your change to ${name} was not saved.` : "Your last change was not saved.";
}

/**
 * A left page's run failed while a page that cannot take its changes is open (Today, the Library): the
 * app's own toast says so, as an alert, with a way back to the page it was made on. A settings page
 * took it (adopt), the index said it (settingsSaved.ts), or an editor still loading will take it.
 */
function tellLost(held: Held, from: SaveContext["from"]): void {
  if (held.claimed || !unclaimed?.held.includes(held)) return;
  const page = globalThis.document;
  if (!page || page.querySelector?.("[data-bar]")) return;
  const message = lostText(from?.name);
  // By event (toastEvent.ts), so the toast's store stays in the sheets' chunk.
  const toast = (detail: object): void => sendToast(detail, page);
  toast({
    message,
    kind: "error",
    ...(from?.path
      ? {
          actionLabel: "Open",
          onAction: () =>
            void import("astro:transitions/client").then(({ navigate }) => navigate(from.path)),
        }
      : {}),
  });
  // It stays until it is used or dismissed, and goes once a settings page is open: that page shows
  // what is saved.
  const off = new AbortController();
  page.addEventListener(
    "astro:after-swap",
    () => {
      if (!location.pathname.startsWith("/settings")) return;
      toast({ dismiss: message });
      off.abort();
    },
    { signal: off.signal },
  );
}

/**
 * Leaving the page open now drops what no page took: it was never saved, and the page opened next is
 * built without it.
 */
export function dropUnclaimed(): void {
  unclaimed = null;
}
globalThis.document?.addEventListener("astro:after-swap", dropUnclaimed);

let passphrase: string | null = null;
/** When the last request went through, by this page's clock; 0 before the first. */
let lastSent = 0;
/** True while a flush runs. A second call returns at once: the running one sends what is waiting. */
let busy = false;
/** Another page's changes that came while a run was busy: sent once it is done. */
const queued = new Set<SaveContext>();

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
  /** The answer's body, for a failure's reference. */
  body?: unknown;
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
      body,
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
  const { changes, dialog } = context;
  if (changes.size === 0) return;
  if (busy) {
    queued.add(context);
    return;
  }
  /**
   * The toast and the page's own reading run here, and neither may ever stop a request: the page
   * they belong to may have been swapped away while the run waited out the gap.
   */
  const show = (message: string, state: SaveState): void => {
    try {
      context.show(message, state);
    } catch {
      // The page is gone; what was waiting is still sent.
    }
  };
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
  /**
   * Whether everything this run sent was a suggested source added with its plus: that row says
   * "Adding" and then "Added" itself, so the toast saying it too would be the same news twice.
   */
  let rowSays = true;
  // Everything waiting goes now, a refused change included: it is on its way again.
  for (const pending of changes.values()) pending.failed = false;
  try {
    while (changes.size > 0) {
      // Inside the server's gap after the last request, wait it out first, quietly: nothing is on
      // its way yet, and whatever changes meanwhile goes in the one request sent after it.
      const hold = gapLeft(lastSent, Date.now());
      if (hold > 0) await new Promise((resolve) => setTimeout(resolve, hold));
      // An edit not final yet (a new topic's emoji, D142) holds the request, quietly, as the gap does.
      const unready = [...changes.values()].filter((pending) => pending.ready);
      if (unready.length > 0) {
        await Promise.all(unready.map((pending) => pending.ready));
        for (const pending of unready) delete pending.ready;
        continue;
      }
      const [batch] = pack(buildQueue(changes), changes);
      if (!batch || JSON.stringify(batch.ops) === last) break;
      sent = true;
      rowSays &&= batch.sent.every(([, pending]) => pending.el.matches(".source-note"));
      if (!rowSays) show(SAVING, "saving");
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
        failure = failureText(answer.status, answer.body);
        // A row that said Adding says so no more: the change stays for Retry, and the row for itself.
        for (const [, pending] of batch.sent) {
          pending.failed = true;
          pending.fail?.();
        }
        break;
      }
      timeRefused ||= answer.timeRefused;
      lastSent = Date.now();
      last = JSON.stringify(batch.ops);
      try {
        settle(batch, changes);
      } finally {
        const body = answer.body as { written_at?: unknown } | undefined;
        const stored = typeof body?.written_at === "number" ? body.written_at : undefined;
        remember(batch.ops, lastSent, heldOps(), stored);
      }
      try {
        context.settled?.();
      } catch {
        // The page is gone: nothing left to read again.
      }
    }
  } finally {
    busy = false;
    // A page left with edits marked pending: the page open now hears how they went and takes what
    // failed, before another page's queued changes go (with them, when that page took them).
    endLeft(context, failure);
    const next = [...queued].filter((other) => other !== context);
    queued.clear();
    for (const other of next) void flush(other, given);
  }
  if ((!sent || rowSays) && !failure) return;
  if (failure) {
    show(failure, "error");
    // The interface sound for an outcome the screen already states (see scripts/uiSound.ts). A save
    // that went through makes none: it happens on its own after every change, and the change itself
    // already made its tick.
    globalThis.document?.dispatchEvent(new CustomEvent("dispatch:sound", { detail: "failure" }));
  } else if (timeRefused) show(TIME_REFUSED, "done");
  else show(SAVED, "saved");
}

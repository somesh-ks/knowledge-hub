/**
 * Sending the pending edits. Loaded the first time Save is pressed, not with the page: nothing here
 * is needed to read or edit, so it stays out of the first-load budget.
 */
import { OPEN_PASSPHRASE, PASSPHRASE_REQUIRED } from "../lib/access";
import type { ConfigOp, ConfigResponse } from "../types/contracts";

const KEY = "dispatch:narrate-passphrase";
const SAVED = "Saved. The changes appear after the next build, in about a minute.";

/** Shown when the edit went through but the site could not change the briefing time. */
const TIME_REFUSED =
  "The topics and cadence are saved. The time could not be changed: the site's GitHub token needs permission to write repository variables.";

const REASONS: Record<number, string> = {
  400: "That change was not accepted.",
  401: PASSPHRASE_REQUIRED ? "That passphrase is not right." : "Saving was refused.",
  429: "There were too many edits in a row.",
  503: "Saving is not available right now.",
};

/** What a refusal means to the person saving, and what is left of their changes. */
export function failureText(status: number, done: number, total: number): string {
  const reason = REASONS[status] ?? "The site could not be reached.";
  return done > 0
    ? `Saved ${done} of ${total}. ${reason} The rest is still waiting.`
    : `${reason} Your changes are still waiting.`;
}

/** One pending change: the edit, the control (or queued row) behind it, and what the control now holds. */
export interface Pending {
  op: ConfigOp;
  /** Edits that go in the same request, after `op`: the sources chosen for a new topic. */
  with?: ConfigOp[];
  el: HTMLElement;
  now: string;
}

export interface SaveContext {
  changes: Map<string, Pending>;
  show(message: string, state: string): void;
  fields: HTMLFieldSetElement;
  dialog: HTMLDialogElement;
}

/**
 * The requests that settle the pending changes. Every slider change goes in one request, after the
 * rest, and a removal goes last so nothing is edited after it is gone.
 */
export function buildQueue(
  changes: ReadonlyMap<string, Pending>,
): { op: ConfigOp; ops?: ConfigOp[]; keys: string[] }[] {
  const weights: Record<string, number> = {};
  const weightKeys: string[] = [];
  const edits: { op: ConfigOp; ops?: ConfigOp[]; keys: string[] }[] = [];
  const removals: { op: ConfigOp; ops?: ConfigOp[]; keys: string[] }[] = [];
  for (const [key, { op, el, with: extra }] of changes) {
    if (op.op === "topic.upsert") {
      // The switch was built with the slider's value from the page load, which may have moved since.
      const slider = el.closest("li")?.querySelector<HTMLInputElement>("[data-weight]");
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

let passphrase: string | null = null;
/** Set by `send` when a saved edit reports that the briefing time was not changed. */
let timeRefused = false;

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

/** One request. The server allows an edit every ten seconds, so a 429 waits as long as it says. */
async function send(
  op: ConfigOp | ConfigOp[],
  given: string,
  wait: (seconds: number) => void,
): Promise<number> {
  for (let tries = 0; tries < 7; tries += 1) {
    let seconds = 0;
    let status = 0;
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: given, op }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<ConfigResponse>;
      status = body.status ?? response.status;
      if (status === 202 && "time_changed" in body && body.time_changed === false)
        timeRefused = true;
      if (status === 429) seconds = ("retry_after_s" in body && body.retry_after_s) || 10;
    } catch {
      status = 0;
    }
    if (!seconds) return status;
    wait(seconds);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 250));
  }
  return 429;
}

/**
 * Asks for the passphrase once if it is not known, then sends the changes one at a time. While the
 * passphrase step is off (lib/access.ts) the fixed value stands in and the dialog never opens.
 */
export async function save(
  context: SaveContext,
  given = PASSPHRASE_REQUIRED ? (passphrase ?? memory()) : OPEN_PASSPHRASE,
): Promise<void> {
  const { changes, show, fields, dialog } = context;
  if (!given) {
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
        void save(context, value);
      },
      { once: true },
    );
    dialog.showModal();
    return;
  }

  passphrase = given;
  timeRefused = false;
  fields.disabled = true;
  const total = changes.size;
  const queue = buildQueue(changes);
  let done = 0;
  let failure = "";
  for (const [index, { op, ops, keys }] of queue.entries()) {
    const place = `Saving ${index + 1} of ${queue.length}`;
    show(place, "saving");
    const status = await send(ops ?? op, given, () =>
      show(`${place}. Waiting a few seconds.`, "saving"),
    );
    if (status !== 202) {
      if (status === 401) {
        memory(null);
        passphrase = null;
      }
      failure = failureText(status, done, total);
      break;
    }
    for (const key of keys) {
      const { el, now } = changes.get(key) as Pending;
      // A change that reached the repository is the page's new starting point.
      if (el.matches("li")) el.remove();
      else if (el.matches("[data-remove]")) el.closest("li")?.setAttribute("data-gone", "");
      else if (el.matches("[data-suggest]")) (el as HTMLButtonElement).disabled = true;
      else el.dataset.was = now;
      changes.delete(key);
      done += 1;
    }
  }
  fields.disabled = false;
  show(failure || (timeRefused ? TIME_REFUSED : SAVED), failure ? "error" : "done");
  // The interface sound for an outcome the screen already states (see scripts/uiSound.ts).
  document.dispatchEvent(
    new CustomEvent("dispatch:sound", { detail: failure ? "failure" : "success" }),
  );
}

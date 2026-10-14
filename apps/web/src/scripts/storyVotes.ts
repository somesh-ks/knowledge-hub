/**
 * The story controls' sending side, loaded on the first press of a control or at idle when votes
 * wait (storyVotesEntry.ts). Votes are held on the device (lib/storyVotes.ts) and go in one
 * `profile.vote` request when the page is hidden or left, or ten minutes after the first unsent
 * vote. A refused or failed request keeps them for the next attempt. Votes make no toast and no
 * sound beyond the control's own.
 *
 * "Stop hearing from this outlet" follows the settings' removal pattern: a toast with Undo, and the
 * `profile.block` request after UNDO_MS. Leaving the page sends it at once.
 */
import type { ConfigOp } from "@dispatch/core";
import { OPEN_PASSPHRASE, PASSPHRASE_REQUIRED } from "../lib/access";
import {
  type BlockOp,
  dueIn,
  markSent,
  markUnsent,
  parseVotes,
  pendingOps,
  press,
  pressedOf,
  type StoryRef,
  VOTES_KEY,
  type VoteState,
} from "../lib/storyVotes";

/** How long a block waits, with Undo in the toast, before it is sent (autosave.ts' UNDO_MS). */
const UNDO_MS = 5000;
/** Where the settings pages keep a remembered passphrase (managePageSave.ts). */
const PASSPHRASE_KEY = "dispatch:narrate-passphrase";
/** The toast's event (sheets/toastStore.ts), spelled out so this code does not load the store. */
const TOAST_EVENT = "dispatch:toast";

let memory: VoteState | null = null;

function load(): VoteState {
  try {
    memory = parseVotes(localStorage.getItem(VOTES_KEY));
  } catch {
    // Storage is blocked: this visit's votes live in memory.
    memory ??= parseVotes(null);
  }
  return memory;
}

function save(state: VoteState): void {
  memory = state;
  try {
    localStorage.setItem(VOTES_KEY, JSON.stringify(state));
  } catch {
    // Blocked or full: the votes still go from memory this visit.
  }
}

/** True when the request went through. `keepalive` lets it finish as the page goes. */
async function post(op: ConfigOp): Promise<boolean> {
  let passphrase: string | null = OPEN_PASSPHRASE;
  if (PASSPHRASE_REQUIRED) {
    try {
      passphrase = localStorage.getItem(PASSPHRASE_KEY);
    } catch {
      passphrase = null;
    }
  }
  if (!passphrase) return false;
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase, op }),
      keepalive: true,
    });
    const body = (await response.json().catch(() => ({}))) as { status?: number };
    return (body.status ?? response.status) === 202;
  } catch {
    return false;
  }
}

let timer = 0;
let sending = false;

/** (Re)arms the ten-minute send for whatever waits. */
function schedule(): void {
  window.clearTimeout(timer);
  const wait = dueIn(load(), Date.now());
  if (wait !== null) timer = window.setTimeout(() => void send(), wait);
}

async function send(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    for (const op of pendingOps(load())) {
      // Counted as sent first: a page being left never hears the answer.
      save(markSent(load(), op));
      if (!(await post(op))) {
        // Kept for the next attempt, ten minutes on or when the page is left.
        save({ ...markUnsent(load(), op), waiting_since: Date.now() });
        return;
      }
    }
  } finally {
    sending = false;
    schedule();
  }
}

/** The stories' controls on the page, for the story with this id. */
function controlsOf(id: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-story-controls]")].filter(
    (el) => el.dataset.storyId === id,
  );
}

function mark(id: string, state: VoteState): void {
  const pressed = pressedOf(state, id);
  for (const controls of controlsOf(id))
    for (const button of controls.querySelectorAll<HTMLElement>("[data-vote]"))
      button.setAttribute("aria-pressed", String(button.dataset.vote === pressed));
}

function refOf(controls: HTMLElement): StoryRef {
  const { storyId, url, headline, topic, sourceId } = controls.dataset;
  return {
    story_id: storyId ?? "",
    url: url ?? "",
    headline: headline ?? "",
    topic: topic ?? "",
    source_id: sourceId ?? "",
  };
}

interface Block {
  timer: number;
  message: string;
  outlet: string;
  host: string;
}
const blocks = new Map<string, Block>();

function toast(detail: object): void {
  document.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
}

async function sendBlock(host: string, outlet: string, message: string): Promise<void> {
  blocks.delete(host);
  const done = await post({ op: "profile.block", domain: host } satisfies BlockOp);
  if (done) toast({ dismiss: message });
  else toast({ message: `Could not stop ${outlet} yet. Try again.`, kind: "error" });
}

function block(controls: HTMLElement): void {
  let host = "";
  try {
    host = new URL(controls.dataset.url ?? "").hostname;
  } catch {
    return;
  }
  if (!host || blocks.has(host)) return;
  const outlet = controls.dataset.outlet || host;
  const message = `No more stories from ${outlet}, from the next briefing.`;
  const entry: Block = {
    timer: window.setTimeout(() => void sendBlock(host, outlet, message), UNDO_MS),
    message,
    outlet,
    host,
  };
  blocks.set(host, entry);
  toast({
    message,
    actionLabel: "Undo",
    onAction: () => {
      window.clearTimeout(entry.timer);
      blocks.delete(host);
    },
  });
}

/** A press on a control with `data-vote` or `data-block`. */
export function handle(button: Element): void {
  const controls = button.closest<HTMLElement>("[data-story-controls]");
  if (!controls) return;
  if (button instanceof HTMLElement && button.dataset.vote) {
    const value = button.dataset.vote === "down" ? "down" : "up";
    const state = press(load(), refOf(controls), value, Date.now());
    save(state);
    mark(controls.dataset.storyId ?? "", state);
    schedule();
  } else block(controls);
}

/** Leaving or hiding the page sends what waits: the votes, and any block still counting down. */
function leave(): void {
  void send();
  for (const { timer: pending, host, outlet, message } of [...blocks.values()]) {
    window.clearTimeout(pending);
    void sendBlock(host, outlet, message);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") leave();
});
window.addEventListener("pagehide", leave);
document.addEventListener("astro:before-preparation", leave);
schedule();

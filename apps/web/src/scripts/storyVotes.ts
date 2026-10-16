/**
 * The story controls' sending side, loaded on the first press of a control or at idle when votes
 * wait (storyVotesEntry.ts). Votes are held on the device (lib/storyVotes.ts) and go in one
 * `profile.vote` request when the page is hidden or left, or ten minutes after the first unsent
 * vote. A refused or failed request keeps them for the next attempt. Votes make no toast and no
 * sound beyond the control's own.
 *
 * "Stop hearing from this outlet" follows the settings' removal pattern: a toast with Undo, and the
 * `profile.block` request after UNDO_MS. Leaving the page sends it at once.
 *
 * Votes also ride along with any stopped outlet, so the two make one request, not two.
 *
 * Every request goes through one sender. The server takes one edit every ten seconds and refuses
 * the next one sooner with a 429 (server/configEdit.ts), so what waits goes in one request, a request
 * is held until the gap after the last one has passed, and a 429 waits as long as it asks and goes
 * again, as the settings pages do (managePageSave.ts). A stopped outlet is kept on the device until
 * the server takes it, so a page left or closed before then sends it on the next visit.
 */
import type { ConfigOp } from "@dispatch/core";
import { OPEN_PASSPHRASE, PASSPHRASE_REQUIRED } from "../lib/access";
import { blockedDomainOf } from "../lib/blockedOutlets";
import { withErrorRef } from "../lib/errorRef";
import { SAVED_KEY } from "../lib/savedKey";
import { addSaved, parseSaved } from "../lib/savedOverlay";
import {
  BLOCKS_KEY,
  type BlockOp,
  dueIn,
  gapLeft,
  markSent,
  markUnsent,
  nextRequest,
  type PendingBlock,
  parseBlocks,
  parseVotes,
  pendingOps,
  press,
  pressedOf,
  recordOpen,
  type StoryRef,
  stopFailure,
  VOTES_KEY,
  type VoteOp,
  type VoteState,
} from "../lib/storyVotes";

/** How long a block waits, with Undo in the toast, before it is sent (autosave.ts' UNDO_MS). */
const UNDO_MS = 5000;
/** Where the settings pages keep a remembered passphrase (managePageSave.ts). */
const PASSPHRASE_KEY = "dispatch:narrate-passphrase";
/** The toast's event (sheets/toastStore.ts), spelled out so this code does not load the store. */
const TOAST_EVENT = "dispatch:toast";
/** How many times one request waits out the server's gap before it is a failure (managePageSave.ts). */
const MAX_WAITS = 6;

let memory: VoteState | null = null;
/**
 * Set once a write is refused (storage blocked, or full while it still reads): from then on memory
 * is the truth for this visit, and storage, which would hand back the state before the refused
 * write, is not read again.
 */
let memoryOnly = false;

function load(): VoteState {
  if (memoryOnly && memory) return memory;
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
    memoryOnly = true;
  }
}

let outboxMemory: PendingBlock[] | null = null;
let outboxMemoryOnly = false;

/** The outlets stopped and not yet taken by the server, oldest first. */
function outbox(): PendingBlock[] {
  if (outboxMemoryOnly && outboxMemory) return outboxMemory;
  try {
    outboxMemory = parseBlocks(localStorage.getItem(BLOCKS_KEY));
  } catch {
    outboxMemory ??= [];
  }
  return outboxMemory;
}

function saveOutbox(blocks: PendingBlock[]): void {
  outboxMemory = blocks;
  try {
    if (blocks.length > 0) localStorage.setItem(BLOCKS_KEY, JSON.stringify(blocks));
    else localStorage.removeItem(BLOCKS_KEY);
  } catch {
    // Blocked or full: this visit still sends them from memory.
    outboxMemoryOnly = true;
  }
}

/** Shows a block the server took on the Blocked outlets page until the build that carries it. */
function rememberSaved(ops: BlockOp[], now: number): void {
  if (ops.length === 0) return;
  try {
    const before = parseSaved(localStorage.getItem(SAVED_KEY), now);
    // addSaved drops the entry a left settings page keeps for edits still on their way; it stays.
    const entries = [...addSaved(before, ops, now), ...before.filter((entry) => entry.pending)];
    localStorage.setItem(SAVED_KEY, JSON.stringify(entries));
  } catch {
    // Storage is refused: the page shows the outlet once the build lands.
  }
}

interface Answer {
  /** 0 when no answer came. */
  status: number;
  /** For a 429, how many seconds it asks to wait. */
  wait: number;
  /** The server's error code, or what kept the request from being answered, for the log. */
  cause: string;
  /** The answer's body, for a server failure's reference (lib/errorRef.ts). */
  body?: unknown;
}

async function post(ops: ConfigOp[]): Promise<Answer> {
  let passphrase: string | null = OPEN_PASSPHRASE;
  if (PASSPHRASE_REQUIRED) {
    try {
      passphrase = localStorage.getItem(PASSPHRASE_KEY);
    } catch {
      passphrase = null;
    }
  }
  if (!passphrase) return { status: 401, wait: 0, cause: "no passphrase on this device" };
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase, op: ops.length === 1 ? ops[0] : ops }),
      keepalive: true,
    });
    const body = (await response.json().catch(() => ({}))) as {
      status?: number;
      retry_after_s?: number;
      error?: string;
    };
    const status = body.status ?? response.status;
    return {
      status,
      wait: status === 429 ? body.retry_after_s || 10 : 0,
      cause: body.error ?? response.statusText,
      body,
    };
  } catch (error) {
    return { status: 0, wait: 0, cause: String(error) };
  }
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

let timer = 0;
let sending = false;
/** Something new to send arrived while a request was on its way. */
let again = false;
/** When the last request went through, for the server's gap. */
let lastSent = 0;
/** The votes go now, due or not: the page is being left. Kept until a run has nothing left. */
let votesNow = false;

/** (Re)arms the next send: at once for a stopped outlet, ten minutes on for votes. */
function schedule(): void {
  window.clearTimeout(timer);
  const wait = outbox().length > 0 ? 0 : dueIn(load(), Date.now());
  if (wait !== null) timer = window.setTimeout(() => void send(false), wait);
}

interface Block {
  timer: number;
  message: string;
  outlet: string;
  host: string;
}
/** Outlets inside their Undo wait. */
const blocks = new Map<string, Block>();
/** The Undo toast of each outlet stopped on this page, to dismiss once the server takes it. */
const messages = new Map<string, string>();

function toast(detail: object): void {
  document.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
}

/** The outlets in the request on its way: too late for Undo. */
const posting = new Set<string>();

/**
 * Sends what waits: every stopped outlet, and the votes when they are due or the page is being left.
 * Votes ride along with a block: one request costs one run, and two inside the gap cost a 429.
 */
async function send(withVotes: boolean): Promise<void> {
  votesNow ||= withVotes;
  if (sending) {
    again = true;
    return;
  }
  sending = true;
  let waits = 0;
  /** Set when a request with votes was refused as invalid: the blocks then go without them. */
  let blocksAlone = false;
  try {
    for (;;) {
      again = false;
      // Held first, then packed: whatever is stopped or left during the hold goes in this request.
      const hold = gapLeft(lastSent, Date.now());
      if (hold > 0) await sleep(hold);
      const blockOps = outbox().map(({ domain }): BlockOp => ({ op: "profile.block", domain }));
      const voteDue =
        !blocksAlone && (votesNow || blockOps.length > 0 || dueIn(load(), Date.now()) === 0);
      const ops = nextRequest(blockOps, voteDue ? pendingOps(load()) : []);
      if (ops.length === 0) {
        votesNow = false;
        return;
      }
      const votes = ops.filter((op): op is VoteOp => op.op === "profile.vote");
      const stopped = ops.filter((op): op is BlockOp => op.op === "profile.block");
      // Counted as sent first: a page being left never hears the answer.
      for (const op of votes) save(markSent(load(), op));
      for (const { domain } of stopped) posting.add(domain);
      const answer = await post(ops);
      for (const { domain } of stopped) posting.delete(domain);
      if (answer.status === 202) {
        lastSent = Date.now();
        waits = 0;
        const taken = new Set(stopped.map((op) => op.domain));
        saveOutbox(outbox().filter((entry) => !taken.has(entry.domain)));
        rememberSaved(stopped, lastSent);
        for (const { domain } of stopped) {
          const message = messages.get(domain);
          messages.delete(domain);
          if (message) toast({ dismiss: message });
        }
        continue;
      }
      for (const op of votes) save(markUnsent(load(), op));
      if (answer.status === 429 && waits < MAX_WAITS) {
        // Another edit went just before this one: wait as long as the server asks, then go again.
        waits += 1;
        await sleep(answer.wait * 1000 + 250);
        continue;
      }
      if (answer.status === 400 && votes.length > 0 && stopped.length > 0) {
        // One list is refused whole: a vote the server will not take must not hold a stop back.
        blocksAlone = true;
        continue;
      }
      // Refused or not answered. The votes wait for the next attempt, ten minutes on or when the page
      // is left; a stopped outlet is said to have failed, with what failed and whether pressing its
      // menu item again can help (stopFailure), and the real answer goes to the console.
      votesNow = false;
      if (votes.length > 0) save({ ...load(), waiting_since: Date.now() });
      const failed = new Set(stopped.map((op) => op.domain));
      const lost = outbox().filter((entry) => failed.has(entry.domain));
      saveOutbox(outbox().filter((entry) => !failed.has(entry.domain)));
      for (const { domain, outlet } of lost) {
        messages.delete(domain);
        console.error(`[story controls] stop ${domain} failed: ${answer.status} ${answer.cause}`);
        toast({
          message: withErrorRef(stopFailure(outlet, answer.status).message, answer.body),
          kind: "error",
        });
      }
      return;
    }
  } finally {
    sending = false;
    if (again) void send(false);
    else schedule();
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

/** The Undo wait is over (or the page is being left): the outlet goes in the next request. */
function commitBlock(entry: Block): void {
  window.clearTimeout(entry.timer);
  blocks.delete(entry.host);
  messages.set(entry.host, entry.message);
  saveOutbox([...outbox(), { domain: entry.host, outlet: entry.outlet }]);
  void send(false);
}

function block(controls: HTMLElement): void {
  let host = "";
  try {
    const name = new URL(controls.dataset.url ?? "").hostname;
    // The server stores the domain as this normalises it; a host it would refuse is sent as it is,
    // so the refusal is told rather than the press doing nothing.
    host = blockedDomainOf(name) ?? name;
  } catch {
    return;
  }
  // Pressed again while it waits for Undo or for the server: it is already on its way.
  if (!host || blocks.has(host) || outbox().some((entry) => entry.domain === host)) return;
  const outlet = controls.dataset.outlet || host;
  const message = `No more stories from ${outlet}, from the next briefing.`;
  const entry: Block = {
    timer: window.setTimeout(() => commitBlock(entry), UNDO_MS),
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
      // Past its five seconds it waits in the outbox, maybe for the server's gap: Undo still takes
      // it back there. Once its request is on its way it goes, as it always did.
      if (!posting.has(host)) {
        messages.delete(host);
        saveOutbox(outbox().filter((pending) => pending.domain !== host));
      }
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

/** A story's link was followed: the open waits on the device for the next request. */
export function opened(controls: HTMLElement): void {
  save(recordOpen(load(), refOf(controls), Date.now()));
  schedule();
}

/**
 * Leaving or hiding the page sends what waits, in one request: the votes, and any block still
 * counting down. Whatever the server does not take stays on the device for the next visit.
 */
function leave(): void {
  for (const entry of [...blocks.values()]) {
    window.clearTimeout(entry.timer);
    blocks.delete(entry.host);
    messages.set(entry.host, entry.message);
    saveOutbox([...outbox(), { domain: entry.host, outlet: entry.outlet }]);
  }
  void send(true);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") leave();
});
window.addEventListener("pagehide", leave);
document.addEventListener("astro:before-preparation", leave);
schedule();

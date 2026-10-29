/**
 * Follows the run this browser started and keeps its record. It lives in the layout and persists
 * across client-side navigations; the run is kept in localStorage, so a reload, or another tab, picks
 * it up (a run an older page kept in sessionStorage is read once and moved). The status route names
 * the stage (n of m, lib/runStages.ts); after the workflow has published, the last stage waits for
 * the new page. It draws nothing: the podcast queue (scripts/queue.ts) paints the record on every
 * change of it (RUN_EVENT), with the sentences in the element (`data-<state>`, or
 * `data-<kind>-<state>` for a rewrite or a removal), except a failed stage's sentence
 * (lib/runStages.ts); this file imports only that and the error reference helper; the episode
 * prewarm is loaded only once a new episode is live.
 *
 * A run keeps the request that started it, so a failed one offers Try again: the same request goes
 * out again and the new run is followed. A run that ended is kept for the day in the podcast queue
 * (lib/queueDay.ts) until the day changes; the sheets island plays the cue for a podcast.
 */

import { isSiteAnswer, withErrorRef } from "../lib/errorRef";
import { forget, remember } from "../lib/queueDay";
import { GENERATION_STARTED_EVENT, RUN_EVENT, RUN_STORAGE_KEY } from "../lib/runRecord";
import { briefingFailureLine, failureLine } from "../lib/runStages";

const KEY = RUN_STORAGE_KEY;
const POLL_MS = 4000;
const MAX_POLLS = 300;
/**
 * A briefing can wait behind a scheduled run that holds for its publish time (up to 135 minutes,
 * D193; they share one workflow group), and a long Regenerate finishes after its audio job. So it is
 * followed for three hours, as the Regenerate sheet followed it, asking every 15 seconds once the
 * first 20 minutes are past.
 */
const SLOW_POLL_MS = 15_000;
const BRIEFING_MAX_POLLS =
  MAX_POLLS + Math.ceil((3 * 3_600_000 - MAX_POLLS * POLL_MS) / SLOW_POLL_MS);
/**
 * The last stage asks this often for the redeployed site: the deploy takes about 35 s, and every
 * second between it landing and the line noticing is a second the listener waits for nothing.
 */
export const SITE_POLL_MS = 2500;
/** Ten minutes of asking, as before, at the faster pace. */
const SITE_POLLS = 240;

export type Phase = "queued" | "running" | "updating" | "done" | "started" | "failed" | "cancelled";
/** What the run does to an episode that exists. Absent means a new episode. */
type Kind = "regenerate" | "delete";
/** What it takes to send a run's request again: its body, and where it goes (episodes by default). */
export interface Retry {
  body: Record<string, unknown>;
  endpoint?: "/api/generate";
}
/** A briefing run: Regenerate or Generate, followed through the same status route as an episode. */
type What = "briefing";
export interface Stored {
  id: number;
  phase: Phase;
  kind?: Kind;
  /** A briefing's run, not an episode's: its stages, its failure sentences and its link say so. */
  what?: What;
  /** The episode a rewrite or a removal is about; its page disables its actions while the run goes. */
  episode?: string;
  /** A finished briefing run that published nothing: why, for its line. */
  outcome?: "nothing" | "gated";
  /** The workflow step a failed briefing stopped in (the status route's `step`). */
  step?: string;
  /** Why a failed run stopped, in the engine's sentence for the listener (the failure record). */
  reason?: string;
  /** Where the status route said the run is; the label is its name for the stage. */
  stage?: number;
  stages?: number;
  label?: string;
  /** When the run was started, so the new page can be told from the old ones. */
  t0?: number;
  /** The request that started the run, for Try again. */
  retry?: Retry;
  /** Where the new episode is, once the site lists it. */
  href?: string;
  /** Said instead of the failure after a Try again was refused (a cooldown names its wait). */
  note?: string;
  /** A failed run's log on GitHub, from the status route: where the real error is. */
  log?: string;
  /** When the run entered the stage it is in, for the time left. */
  stageAt?: number;
  /** The usual length of each stage in ms (the route's stage_estimates_ms), when it knows them. */
  estimates?: (number | null)[];
  /** A failed run: the stage it stopped in and what the earlier stages kept (the route's words). */
  failedStage?: string;
  kept?: string[];
  /** Where polling ran out, so Check again asks the same question again. */
  lostIn?: "follow" | "site";
}

/** The stage fields of a status answer, kept with the run. */
const staged = (body: {
  stage?: number;
  stages?: number;
  label?: string;
  stage_estimates_ms?: unknown;
  failed_stage?: unknown;
  kept?: unknown;
  reason?: unknown;
  step?: unknown;
}) => ({
  reason: typeof body.reason === "string" && body.reason ? body.reason : undefined,
  step: typeof body.step === "string" ? body.step : undefined,
  stage: body.stage,
  stages: body.stages,
  label: body.label,
  estimates: Array.isArray(body.stage_estimates_ms)
    ? (body.stage_estimates_ms as (number | null)[])
    : undefined,
  failedStage: typeof body.failed_stage === "string" ? body.failed_stage : undefined,
  kept: Array.isArray(body.kept) ? body.kept.map(String) : undefined,
});

const FINISHED: Phase[] = ["done", "started", "failed", "cancelled"];
/** A finished rewrite's line is news for minutes: on a page that opens later it has gone stale. */
const STALE_REWRITE_MS = 10 * 60_000;
/** Phases of a run that is still going: Create waits for it (createPage.ts). */
export const GOING = ["queued", "running", "updating"];
let following = 0;
/** True while a Try again request is out. */
let retrying = false;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const parse = (text: string | null): Stored | null => {
  try {
    const value = JSON.parse(text ?? "null");
    return value && typeof value.id === "number" ? value : null;
  } catch {
    return null;
  }
};

/**
 * The run on record: localStorage, so every tab shows it. A run an older page kept in
 * sessionStorage under the same key is moved over once, so a run under way across the update is kept.
 */
export function readRun(local: Store, session: Store): Stored | null {
  const run = parse(local.getItem(KEY));
  if (run) return run;
  const old = parse(session.getItem(KEY));
  if (old) {
    try {
      local.setItem(KEY, JSON.stringify(old));
      session.removeItem(KEY);
    } catch {
      // Moving it is best effort: the session copy stays valid when localStorage refuses.
    }
  }
  return old;
}

function read(): Stored | null {
  try {
    return readRun(localStorage, sessionStorage);
  } catch {
    return null;
  }
}

function write(run: Stored | null): void {
  try {
    if (run) localStorage.setItem(KEY, JSON.stringify(run));
    else localStorage.removeItem(KEY);
    // The old key is never read again once the record is here, or a cleared run would come back.
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked; the indicator then lasts until the page does.
  }
}

const BADGE = "● ";

/** A run that finished while the tab was out of sight: the title says so until the tab is looked at. */
function markTitle(): void {
  if (document.hidden && !document.title.startsWith(BADGE)) document.title = BADGE + document.title;
}

function clearTitle(): void {
  if (!document.hidden && document.title.startsWith(BADGE)) {
    document.title = document.title.slice(BADGE.length);
  }
}

// Looking at the tab again takes the badge off its title.
if (typeof document !== "undefined") document.addEventListener("visibilitychange", clearTitle);

/**
 * The button that was pressed is gone with its card: focus goes to the Create button in view, or,
 * on a page that shows none, to the page's main region, so it never drops to the body.
 */
export function focusCreate(): void {
  for (const create of document.querySelectorAll<HTMLElement>("[data-create-open]")) {
    if (create.getClientRects().length) {
      create.focus();
      return;
    }
  }
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus({ preventScroll: true });
}

/** True when `href` is the page on screen. */
function samePage(href: string): boolean {
  const path = new URL(href, location.href).pathname.replace(/\/$/, "");
  return path === location.pathname.replace(/\/$/, "");
}

/** What the card says for a run, from the sentences the element carries (`data-<state>`). */
export function statusLine(run: Stored, words: Record<string, string | undefined>): string {
  const word = (key: string): string => words[key] ?? "";
  const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
  // A run the person stopped is not an error: it says so and offers nothing but to be dismissed.
  if (run.phase === "cancelled") return word("cancelled");
  if (run.phase === "failed") {
    if (run.note) return run.note;
    if (run.what) return briefingFailureLine(run.step) ?? word("briefingFailed");
    if (!run.kind) {
      const sentence = failureLine(run.failedStage, run.kept);
      if (sentence) return sentence;
      if (run.label) return word("failedStage").replace("{label}", run.label.toLowerCase());
    }
  }
  if (run.what) {
    if (run.phase === "done") {
      return word(
        run.outcome === "nothing"
          ? "briefingNothing"
          : run.outcome === "gated"
            ? "briefingGated"
            : "briefingDone",
      );
    }
    if (run.phase === "queued") return word("briefingQueued");
    if (run.phase === "started") return word("started");
    return run.label ?? word("briefingRunning");
  }
  const named = !run.kind && run.label && run.phase !== "queued";
  // A new episode says its stage. Only a change is written, so a screen reader hears each stage once.
  if (named && run.phase !== "done" && run.phase !== "started" && run.phase !== "failed") {
    return run.label ?? "";
  }
  const key = run.kind ? run.kind + cap(run.phase) : "";
  return words[key] ?? word(run.phase);
}

/**
 * Draws the run: the queue (scripts/queue.ts) paints it from the record and is told by an event, so
 * this keeps the page's own state in step: the Create buttons say why they cannot start another run
 * while one goes, and a finished episode already on screen is forgotten as the record (not as a row of
 * the queue). A run that ended is kept for the day first (lib/queueDay.ts): the queue draws it from there.
 */
function show(run: Stored | null): void {
  const root = document.querySelector<HTMLElement>("[data-run-status]");
  if (!root) return;
  if (run && run.kind !== "delete") {
    try {
      if (FINISHED.includes(run.phase)) remember(localStorage, run, run.stageAt ?? Date.now());
      else forget(localStorage, run.id);
    } catch {
      // The queue then shows only the run on record.
    }
  }
  // The new episode is the page on screen: it has been found, so there is nothing to open.
  if (run?.phase === "done" && run.href && !run.what && samePage(run.href)) {
    write(null);
    run = null;
  }
  // New episode says why it cannot start another while this one is going.
  const going = run ? GOING.includes(run.phase) : false;
  for (const create of document.querySelectorAll<HTMLElement>("[data-create-open]")) {
    if (going) {
      const busy = run?.what ? root.dataset.busyBriefing : root.dataset.busyCreate;
      create.setAttribute("aria-description", busy ?? "");
    } else create.removeAttribute("aria-description");
  }
  // The queue and the episode page listen, so each can redraw: the page disables its actions while
  // its own episode is being changed.
  document.dispatchEvent(new Event(RUN_EVENT));
}

function set(run: Stored): void {
  write(run);
  show(run);
  if (FINISHED.includes(run.phase) && run.phase !== "cancelled") markTitle();
}

/** Check again: polling ran out, so ask once more where the run is, the way it was asked before. */
export function checkAgain(): void {
  const run = read();
  if (!run || run.phase !== "started") return;
  const phase: Phase = run.lostIn === "site" ? "updating" : "running";
  const next: Stored = { ...run, phase, lostIn: undefined };
  following = 0;
  set(next);
  if (phase === "updating") void waitForSite(next);
  else void follow(next, true);
}

/** The last stage: ask until the redeployed site lists the new episode, then offer it. */
async function waitForSite(run: Stored): Promise<void> {
  if (following === run.id) return;
  following = run.id;
  for (let turn = 0; turn < SITE_POLLS && following === run.id; turn += 1) {
    // No query string: no-store already skips the browser's cache, and the service worker keeps
    // one copy of /latest.json to tell a new briefing by. A copy per poll would push out real pages.
    const res = await fetch("/latest.json", { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    if (following !== run.id) return;
    if (body?.episode_at && Date.parse(body.episode_at) >= (run.t0 ?? 0) - 60_000) {
      following = 0;
      set({ ...run, phase: "done", ...(body.episode_id ? { href: `/e/${body.episode_id}` } : {}) });
      // The new episode's first turns are made now, so the first Play finds files. Best effort.
      if (body.episode_id) {
        const episode = String(body.episode_id);
        void import("../narration/prewarmEpisode")
          .then((prewarm) => prewarm.prewarmEpisode(episode))
          .catch(() => undefined);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SITE_POLL_MS));
  }
  if (following === run.id) {
    following = 0;
    set({ ...run, phase: "started", lostIn: "site" });
  }
}

/**
 * While a new episode is written, its script is copied to Blob turn by turn (lib/liveStream.ts). Ask
 * for the copy until the writer is done, and offer Listen now as soon as the first turns are there:
 * the committed episode is still a minute or more away. The copy is temporary and may never come
 * (no Blob token, an old run); then nothing here changes.
 */
const STREAM_POLL_MS = 2500;
const STREAM_POLLS = 100;
let watching = 0;
let live: { runId: number; doc: Record<string, unknown> } | null = null;

/**
 * Poll a new episode's live script and offer Listen now once turns exist. Briefings and episode
 * changes are ignored; fetch and JSON failures are retried within the polling limit.
 */
async function watchStream(run: Stored): Promise<void> {
  if (watching === run.id || run.kind || run.what) return;
  watching = run.id;
  for (let turn = 0; turn < STREAM_POLLS && watching === run.id; turn += 1) {
    const res = await fetch(`/api/stream?run=${run.id}`, { cache: "no-store" }).catch(() => null);
    const doc = res?.ok ? await res.json().catch(() => null) : null;
    if (watching !== run.id) return;
    if (Array.isArray(doc?.turns) && doc.turns.length > 0 && doc.status !== "failed") {
      const first = live?.runId !== run.id;
      live = { runId: run.id, doc };
      if (first) show(read());
    }
    if (doc && doc.status !== "writing" && doc.status !== "waiting") break;
    await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS));
  }
  if (watching === run.id) watching = 0;
}

/**
 * What the live copy of the episode being written says of itself, for the generations list: its
 * title and the colour of its cover until the drawn cover is deployed. Null before the copy has
 * turns, and for a run it is not about.
 */
export function liveHint(): { runId: number; title: string | null; tint: string | null } | null {
  if (!live) return null;
  const { title, cover_key: tint } = live.doc as { title?: unknown; cover_key?: unknown };
  return {
    runId: live.runId,
    title: typeof title === "string" ? title : null,
    tint: typeof tint === "string" ? tint : null,
  };
}

/** Listen now: plays the live copy from the persistent player. */
export async function listenLive(): Promise<void> {
  if (!live) return;
  const { runId, doc } = live;
  const runtime = await import("../narration/narrationRuntime");
  runtime.narrateLive(doc as never, runId);
}

/**
 * Follow workflow status until completion, replacement by another run, or the polling limit.
 * `now` skips the initial delay. Briefings finish from the workflow result; new episodes may then
 * wait for the site. Fetch and JSON failures are retried; a 4xx or exhausted limit leaves Check again.
 */
async function follow(run: Stored, now: boolean): Promise<void> {
  if (following === run.id) return;
  following = run.id;
  let phase = run.phase;
  let stage = run.stage;
  let estimated = Boolean(run.estimates?.length);
  let stageAt = run.stageAt;
  const polls = run.what ? BRIEFING_MAX_POLLS : MAX_POLLS;
  for (let turn = 0; turn < polls && following === run.id; turn += 1) {
    if (turn > 0 || !now) {
      const wait = turn >= MAX_POLLS ? SLOW_POLL_MS : POLL_MS;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    if (following !== run.id) return;
    const asked = run.retry?.body.request as
      | { format?: string; length_minutes?: number }
      | undefined;
    const about =
      !run.what && asked?.format ? `&format=${asked.format}&length=${asked.length_minutes}` : "";
    const res = await fetch(`/api/status?run=${run.id}${about}`).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    // An answer for a run that is no longer followed (another was started while it was out) is
    // not this run's card to draw, nor its polling to stop.
    if (following !== run.id) return;
    // A run the status route does not know (a 4xx): the episode was started all the same, so say
    // that and stop asking. A hiccup is asked again, until the loop runs out.
    if (res && res.status < 500 && !res.ok) break;
    if (!body?.state) continue;
    if (body.state === "running") void watchStream(run);
    if (body.state === "completed" && run.what) {
      // A briefing is live as soon as the workflow has committed it (live content, D199): there is
      // no deploy to wait for, so it is done, and the line offers it.
      following = 0;
      const failed = body.outcome === "failed";
      const next: Stored = {
        ...run,
        ...staged(body),
        phase: body.outcome === "cancelled" ? "cancelled" : failed ? "failed" : "done",
        stageAt: Date.now(),
        ...(body.outcome === "nothing" || body.outcome === "gated"
          ? { outcome: body.outcome }
          : {}),
        ...(body.outcome === "published" && typeof body.digest_id === "string"
          ? { href: `/d/${body.digest_id}` }
          : {}),
        ...(failed && typeof body.run_url === "string" ? { log: body.run_url } : {}),
      };
      set(next);
      return;
    }
    if (body.state === "completed") {
      following = 0;
      const failed = body.outcome === "failed";
      // Published: a new episode still has to reach the site. An answer without stages is an older
      // route's, and finishes at once.
      const cancelled = body.outcome === "cancelled";
      const waiting = !failed && !cancelled && !run.kind && body.stages;
      const phase: Phase = cancelled
        ? "cancelled"
        : failed
          ? "failed"
          : waiting
            ? "updating"
            : "done";
      const next: Stored = { ...run, ...staged(body), phase, stageAt: Date.now() };
      if (failed && typeof body.run_url === "string") next.log = body.run_url;
      if (waiting)
        next.label = document.querySelector<HTMLElement>("[data-run-status]")?.dataset.updating;
      set(next);
      if (waiting) void waitForSite(next);
      // The removed episode's page has nothing left to show: go to the Library, where the line stays.
      if (!failed && run.kind === "delete" && location.pathname.startsWith("/e/")) {
        location.assign("/library");
      }
      return;
    }
    const next = body.state === "queued" ? "queued" : "running";
    // Estimates that first arrive mid-stage (an older record, a first poll without them) are stored too.
    const gotEstimates =
      !estimated && Array.isArray(body.stage_estimates_ms) && body.stage_estimates_ms.length > 0;
    const moved = next !== phase || body.stage !== stage;
    if (moved || gotEstimates) {
      if (moved) {
        phase = next;
        stage = body.stage;
        stageAt = Date.now();
      }
      if (gotEstimates) estimated = true;
      set({ ...run, ...staged(body), phase, stageAt });
    }
  }
  if (following === run.id) {
    following = 0;
    set({ ...run, phase: "started", lostIn: "follow" });
  }
}

/**
 * Starts showing and following a run that has just been accepted. `retry` is the request that
 * started it, so a failure can offer Try again.
 */
export function startRun(
  id: number,
  about?: { kind: Kind; episode: string } | { what: What },
  retry?: Retry,
): void {
  const run: Stored = {
    id,
    phase: "queued",
    t0: Date.now(),
    ...about,
    ...(retry ? { retry } : {}),
  };
  following = 0;
  set(run);
  // The generations list opens on a wide screen to show it (scripts/generations.ts).
  document.dispatchEvent(new Event(GENERATION_STARTED_EVENT));
  void follow(run, false);
}

/** True while a run of any kind is going: nothing else is started until it is done. */
export function isRunGoing(): boolean {
  const run = read();
  return run !== null && GOING.includes(run.phase);
}

/** An episode was removed: a finished line about it (a rewrite, a failure) has nothing left to say. */
export function forgetRunAbout(episode: string): void {
  const run = read();
  if (run?.episode !== episode || !FINISHED.includes(run.phase)) return;
  write(null);
  show(null);
}

/** After a reload or a navigation: shows the stored run again and, if it is still going, follows it. */
export function resumeRun(): void {
  let run = read();
  if (
    run?.kind === "regenerate" &&
    run.phase === "done" &&
    Date.now() - (run.t0 ?? 0) > STALE_REWRITE_MS
  ) {
    write(null);
    run = null;
  }
  show(run);
  if (run?.phase === "updating") void waitForSite(run);
  else if (run && !FINISHED.includes(run.phase)) void follow(run, true);
}

/** "2 minutes", "3 hours": the server's wait, as the Create form says it. */
function waitFor(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  const h = Math.round(m / 60);
  return m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`;
}

/**
 * The line a refused Try again shows, from the element's data-retry-<reason> sentences. A briefing
 * has its own words for a wait (`briefing-<reason>`), and a wait of a kind nobody wrote words for
 * still says something, so the button never answers with nothing.
 */
export function refusal(
  root: Pick<HTMLElement, "getAttribute">,
  res: Pick<Response, "status"> | null,
  reply: Record<string, unknown>,
  briefing = false,
): string {
  const line = (reason: string) => root.getAttribute(`data-retry-${reason}`) ?? "";
  if (!res) return line("network");
  if (res.status === 429) {
    const reason = String(reply.error);
    const words = (briefing ? line(`briefing-${reason}`) : "") || line(reason) || line("429");
    return words.replace("{wait}", waitFor(Number(reply.retry_after_s) || 60));
  }
  if (res.status === 400) return line("400");
  return isSiteAnswer(reply) ? withErrorRef(line("503"), reply) : line("crashed");
}

/**
 * Try again: the failed run's request goes out again and the new run is followed. A refusal says
 * why in the line, in the form's words; a cooldown names its own wait.
 */
export async function retry(): Promise<void> {
  const run = read();
  const root = document.querySelector<HTMLElement>("[data-run-status]");
  // The dock and the popover each hold a row, so each has a Try again.
  const buttons = [...(root?.querySelectorAll<HTMLButtonElement>("[data-queue-retry]") ?? [])];
  if (!run?.retry || !root || buttons.length === 0 || retrying) return;
  retrying = true;
  const words = buttons[0]?.textContent ?? "";
  for (const button of buttons) {
    button.setAttribute("aria-disabled", "true");
    button.textContent = root.dataset.starting ?? "";
  }
  const res = await fetch(run.retry.endpoint ?? "/api/podcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // A failed run that kept its earlier stages is resumed from them, not made again from nothing.
    body: JSON.stringify({
      ...run.retry.body,
      ...(run.kept?.length ? { resume_from: run.id } : {}),
    }),
  }).catch(() => null);
  const reply = (await res?.json().catch(() => null)) ?? {};
  retrying = false;
  for (const button of buttons) {
    button.removeAttribute("aria-disabled");
    button.textContent = words;
  }
  if (res?.status === 202 && reply.run_id) {
    // The new run replaces the failed one in the queue.
    try {
      forget(localStorage, run.id);
    } catch {
      // Nothing kept to forget.
    }
    const about = run.what
      ? { what: run.what }
      : run.kind && run.episode
        ? { kind: run.kind, episode: run.episode }
        : undefined;
    startRun(reply.run_id, about, run.retry);
    focusCreate();
    return;
  }
  set({ ...run, note: refusal(root, res, reply, run.what === "briefing") || undefined });
}

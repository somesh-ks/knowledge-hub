/**
 * The run indicator: one line of status over a thin progress bar, in the side column from 64rem and
 * above the player bar below it. It lives in the layout and persists across client-side navigations;
 * the run is kept in localStorage, so a reload, or another tab, picks it up (a run an older page
 * kept in sessionStorage is read once and moved). The status route names
 * the stage (n of m, lib/runStages.ts); the bar sits at the start of that stage and creeps toward,
 * never to, the next one on a slow CSS transition, so it never stands still and never goes back.
 * After the workflow has published, the last stage waits for the new page. Every sentence is in the
 * element (`data-<state>`, or `data-<kind>-<state>` for a rewrite or a removal), except a failed
 * stage's sentence (lib/runStages.ts); this file imports only that and the error reference helper up front; the episode prewarm is loaded only once a new episode is
 * live.
 *
 * A run keeps the request that started it, so a failed one offers Try again: the same request goes
 * out again and the new run is followed. A finished run goes away once its episode has been opened.
 */
import { isSiteAnswer, withErrorRef } from "../lib/errorRef";
import { failureLine, timeLeft } from "../lib/runStages";

const KEY = "singularity:run";
const POLL_MS = 4000;
const MAX_POLLS = 300;
/**
 * The last stage asks this often for the redeployed site: the deploy takes about 35 s, and every
 * second between it landing and the line noticing is a second the listener waits for nothing.
 */
export const SITE_POLL_MS = 2500;
/** Ten minutes of asking, as before, at the faster pace. */
const SITE_POLLS = 240;

type Phase = "queued" | "running" | "updating" | "done" | "started" | "failed";
/** What the run does to an episode that exists. Absent means a new episode. */
type Kind = "regenerate" | "delete";
/** What it takes to send a run's request again: its body. */
export interface Retry {
  body: Record<string, unknown>;
}
interface Stored {
  id: number;
  phase: Phase;
  kind?: Kind;
  /** The episode a rewrite or a removal is about; its page disables its actions while the run goes. */
  episode?: string;
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
  estimates?: number[];
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
}) => ({
  stage: body.stage,
  stages: body.stages,
  label: body.label,
  estimates: Array.isArray(body.stage_estimates_ms)
    ? (body.stage_estimates_ms as number[])
    : undefined,
  failedStage: typeof body.failed_stage === "string" ? body.failed_stage : undefined,
  kept: Array.isArray(body.kept) ? body.kept.map(String) : undefined,
});

const FINISHED: Phase[] = ["done", "started", "failed"];
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

/** The time-left line for a run, or "" when it has nothing to say (lib/runStages.ts timeLeft). */
function etaLine(root: HTMLElement, run: Stored | null): string {
  if (!run || run.kind || !GOING.includes(run.phase)) return "";
  const left = timeLeft(
    run.stage ?? 0,
    run.estimates,
    Date.now() - (run.stageAt ?? run.t0 ?? Date.now()),
  );
  if (left.kind === "slow") return root.dataset.slow ?? "";
  if (left.kind === "left") return (root.dataset.eta ?? "").replace("{n}", String(left.minutes));
  return "";
}

/** Writes the time left under the stage name, and tells a screen reader once when the words change. */
function showEta(root: HTMLElement, card: HTMLElement, run: Stored | null): void {
  const eta = card.querySelector<HTMLElement>("[data-run-eta]");
  const text = etaLine(root, run);
  if (eta && eta.textContent !== text) eta.textContent = text;
  if (eta) eta.hidden = !text;
  const announce = root.querySelector("[data-run-announce]");
  const line = card.querySelector("[data-run-text]")?.textContent ?? "";
  const said = text ? `${line}. ${text}` : line;
  if (announce && run && announce.textContent !== said) announce.textContent = said;
}

/** The minutes move on between polls: the line is brought up to date without redrawing the card. */
function refreshEta(): void {
  const root = document.querySelector<HTMLElement>("[data-run-status]");
  const card = root?.querySelector<HTMLElement>("[data-run-card]");
  if (root && card && !card.hidden) showEta(root, card, read());
}

/**
 * The card arrives from where the Create sheet was (a FLIP on transform and opacity only: it starts
 * at the sheet's centre, smaller, and settles into its place). Below 64rem the strip fades in, and
 * with reduced motion every width crossfades (fades keep their time, travel goes).
 */
export function morphFrom(from: DOMRect): void {
  const card = document.querySelector<HTMLElement>("[data-run-card]");
  if (!card || card.hidden || typeof card.animate !== "function") return;
  const to = card.getBoundingClientRect();
  if (!to.width) return;
  const css = getComputedStyle(card);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wide = matchMedia("(width >= 64rem)").matches;
  const duration =
    Number.parseFloat(css.getPropertyValue(reduced ? "--duration-enter" : "--duration-sheet-in")) ||
    300;
  const easing = css.getPropertyValue("--ease-out").trim() || "ease-out";
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const start =
    reduced || !wide
      ? { opacity: 0 }
      : { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.6)` };
  card.animate([start, { opacity: 1, transform: "none" }], { duration, easing });
}

function dismiss(): void {
  following = 0;
  write(null);
  show(null);
  focusCreate();
}

/**
 * The button that was pressed is gone with the card: focus goes to the Create button in view, or,
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

function show(run: Stored | null): void {
  const root = document.querySelector<HTMLElement>("[data-run-status]");
  const card = root?.querySelector<HTMLElement>("[data-run-card]");
  if (!root || !card) return;
  if (!root.hasAttribute("data-bound")) {
    root.setAttribute("data-bound", "");
    document.addEventListener("visibilitychange", clearTitle);
    root.addEventListener("click", (event) => {
      const target = event.target as Element;
      if (target.closest("[data-run-dismiss]")) dismiss();
      if (target.closest("[data-run-retry]")) void retry();
      if (target.closest("[data-run-play]")) void listenLive();
      if (target.closest("[data-run-check]")) checkAgain();
      // Below 64rem the strip is one slim line; a press on it, or on its chevron, opens it.
      if (
        target.closest("[data-run-expand]") ||
        (target.closest(".run-text") && !matchMedia("(width >= 64rem)").matches)
      ) {
        const open = card.toggleAttribute("data-expanded");
        card.querySelector("[data-run-expand]")?.setAttribute("aria-expanded", String(open));
      }
      // The episode, or the Library, is being opened: the line has said what it had to. It goes
      // after the press has been handled, so the link still leads where it points.
      if (target.closest("[data-run-library]")) {
        write(null);
        setTimeout(() => {
          if (!read()) show(null);
        });
      }
    });
  }
  // The new episode is the page on screen: it has been found, so the line goes and gives back the
  // room it kept.
  if (run?.phase === "done" && run.href && samePage(run.href)) {
    write(null);
    run = null;
  }
  const finished = run ? FINISHED.includes(run.phase) : false;
  const announce = root.querySelector("[data-run-announce]");
  card.hidden = !run;
  if (run) {
    card.dataset.state = run.phase;
    // A failed or lost run opens the strip once, so its whole sentence reads on a phone (the owner
    // asked for plain error messages). The reader can close it again: it opens once for each run.
    const alarm = run.phase === "failed" || run.phase === "started" ? `${run.id}:${run.phase}` : "";
    if (alarm && card.dataset.opened !== alarm) {
      card.dataset.opened = alarm;
      card.setAttribute("data-expanded", "");
      card.querySelector("[data-run-expand]")?.setAttribute("aria-expanded", "true");
    }
    const text = card.querySelector("[data-run-text]");
    // A rewrite in the "running" phase reads data-regenerate-running; a new episode reads data-running.
    const key = run.kind ? run.kind + run.phase.charAt(0).toUpperCase() + run.phase.slice(1) : "";
    // A new episode says its stage. Only a change is written, so a screen reader hears each stage once.
    const named = !run.kind && run.label && run.phase !== "queued";
    const line =
      run.phase === "failed" && run.note
        ? run.note
        : !run.kind && run.phase === "failed" && failureLine(run.failedStage, run.kept)
          ? failureLine(run.failedStage, run.kept)
          : named && run.phase === "failed"
            ? (root.dataset.failedStage ?? "").replace("{label}", run.label?.toLowerCase() ?? "")
            : named && run.phase !== "done" && run.phase !== "started"
              ? run.label
              : (root.dataset[key] ?? root.dataset[run.phase]);
    if (text && text.textContent !== (line ?? "")) text.textContent = line ?? "";
    // The status region hears the line and the time left together, and only when they change.
    showEta(root, card, run);
    fill(card, run);
  } else if (announce) {
    // The card is gone and so is what it said: browse mode must not read a finished run's last line.
    announce.textContent = "";
  }
  const library = card.querySelector<HTMLAnchorElement>("[data-run-library]");
  if (library) {
    // A new episode's link leads to it once the site lists it; anything else leads to the Library.
    const href = run?.href ?? "/library";
    if (library.getAttribute("href") !== href) library.setAttribute("href", href);
    // Not `data-library`: that is the Library page's own root, and a link carrying it was found first.
    library.dataset.runWords ??= library.textContent ?? "";
    const words = run?.href ? root.dataset.open : library.dataset.runWords;
    if (words && library.textContent !== words) library.textContent = words;
    // A link to the page on screen would only load it again, so the line offers none there.
    library.hidden =
      (run?.phase !== "done" && run?.phase !== "started") ||
      run?.kind === "delete" ||
      samePage(href);
  }
  // Listen now: offered while the episode is being written and its first turns exist; once the
  // committed episode is found, Open episode is the way in.
  const listen = card.querySelector<HTMLButtonElement>("[data-run-play]");
  if (listen) {
    listen.hidden = !(run && !run.kind && live?.runId === run.id && GOING.includes(run.phase));
  }
  // A failed run links to its log, which says what went wrong.
  const log = card.querySelector<HTMLAnchorElement>("[data-run-log]");
  if (log) {
    const href =
      run?.phase === "failed" && run.log?.startsWith("https://github.com/") ? run.log : "";
    if (href && log.getAttribute("href") !== href) log.setAttribute("href", href);
    log.hidden = !href;
  }
  const check = card.querySelector<HTMLButtonElement>("[data-run-check]");
  if (check) check.hidden = run?.phase !== "started";
  const again = card.querySelector<HTMLButtonElement>("[data-run-retry]");
  if (again) again.hidden = !(run?.phase === "failed" && run.retry);
  const close = card.querySelector<HTMLElement>("[data-run-dismiss]");
  if (close) close.hidden = !finished;
  // The page reserves room for the indicator while it is up, the way it does for the player bar.
  if (run) document.documentElement.dataset.run = run.phase;
  else delete document.documentElement.dataset.run;
  // New episode says why it cannot start another while this one is going.
  const going = run ? GOING.includes(run.phase) : false;
  for (const create of document.querySelectorAll<HTMLElement>("[data-create-open]")) {
    if (going) create.setAttribute("aria-description", root.dataset.busyCreate ?? "");
    else create.removeAttribute("aria-description");
  }
  // The episode page listens, so it can disable its actions while its own episode is being changed.
  document.dispatchEvent(new Event("singularity:run"));
}

/** The bar: at the start of the stage at once, then slowly toward its end, and never back. */
let creep = 0;
export function fill(card: HTMLElement, run: Stored): void {
  // A rewrite or a removal has no last stage of its own: the page has nothing to wait for.
  const total = (run.stages ?? 3) - (run.kind ? 1 : 0);
  const stage = Math.min(run.stage ?? 0, total - 1);
  const key = `${run.id}:${run.phase}:${stage}`;
  if (card.dataset.fill === key) return;
  card.dataset.fill = key;
  clearTimeout(creep);
  // A new run (a Try again) starts from nothing: the failed run's fill is not its progress. The bar
  // never goes back within one run only.
  if (card.dataset.run !== String(run.id)) {
    card.dataset.run = String(run.id);
    card.style.setProperty("--run-to", "0");
    card.style.setProperty("--run-span", "0s");
    // The empty bar is drawn before the new stage's fill starts from it.
    card.getBoundingClientRect();
  }
  const at = (to: number, seconds: number) => {
    const now = Number(card.style.getPropertyValue("--run-to")) || 0;
    card.style.setProperty("--run-to", String(Math.max(now, to)));
    card.style.setProperty("--run-span", `${seconds}s`);
  };
  at(stage / total, 0.4);
  // With reduced motion the bar waits at the start of the stage instead of drifting.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  creep = window.setTimeout(() => at((stage + 0.9) / total, 60), 400);
}

function set(run: Stored): void {
  write(run);
  show(run);
  if (FINISHED.includes(run.phase)) markTitle();
}

/** Check again: polling ran out, so ask once more where the run is, the way it was asked before. */
function checkAgain(): void {
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

async function watchStream(run: Stored): Promise<void> {
  if (watching === run.id || run.kind) return;
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

/** Listen now: plays the live copy from the persistent player. */
async function listenLive(): Promise<void> {
  if (!live) return;
  const { runId, doc } = live;
  const runtime = await import("../narration/narrationRuntime");
  runtime.narrateLive(doc as never, runId);
}

async function follow(run: Stored, now: boolean): Promise<void> {
  if (following === run.id) return;
  following = run.id;
  let phase = run.phase;
  let stage = run.stage;
  let estimated = Boolean(run.estimates?.length);
  let stageAt = run.stageAt;
  for (let turn = 0; turn < MAX_POLLS && following === run.id; turn += 1) {
    if (turn > 0 || !now) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (following !== run.id) return;
    const asked = run.retry?.body.request as
      | { format?: string; length_minutes?: number }
      | undefined;
    const about = asked?.format ? `&format=${asked.format}&length=${asked.length_minutes}` : "";
    const res = await fetch(`/api/status?run=${run.id}${about}`).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    // A run the status route does not know (a 4xx): the episode was started all the same, so say
    // that and stop asking. A hiccup is asked again, until the loop runs out.
    if (res && res.status < 500 && !res.ok) break;
    if (!body?.state) continue;
    refreshEta();
    if (body.state === "running") void watchStream(run);
    if (body.state === "completed") {
      following = 0;
      const failed = body.outcome === "failed";
      // Published: a new episode still has to reach the site. An answer without stages is an older
      // route's, and finishes at once.
      const waiting = !failed && !run.kind && body.stages;
      const phase: Phase = failed ? "failed" : waiting ? "updating" : "done";
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
export function startRun(id: number, about?: { kind: Kind; episode: string }, retry?: Retry): void {
  const run: Stored = {
    id,
    phase: "queued",
    t0: Date.now(),
    ...about,
    ...(retry ? { retry } : {}),
  };
  following = 0;
  set(run);
  void follow(run, false);
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

/** The line a refused Try again shows, from the element's data-retry-<reason> sentences. */
function refusal(root: HTMLElement, res: Response | null, reply: Record<string, unknown>): string {
  const line = (reason: string) => root.getAttribute(`data-retry-${reason}`) ?? "";
  if (!res) return line("network");
  if (res.status === 429) {
    return line(String(reply.error)).replace("{wait}", waitFor(Number(reply.retry_after_s) || 60));
  }
  if (res.status === 400) return line("400");
  return isSiteAnswer(reply) ? withErrorRef(line("503"), reply) : line("crashed");
}

/**
 * Try again: the failed run's request goes out again and the new run is followed. A refusal says
 * why in the line, in the form's words; a cooldown names its own wait.
 */
async function retry(): Promise<void> {
  const run = read();
  const root = document.querySelector<HTMLElement>("[data-run-status]");
  const button = root?.querySelector<HTMLButtonElement>("[data-run-retry]");
  if (!run?.retry || !root || !button || retrying) return;
  retrying = true;
  const words = button.textContent;
  button.setAttribute("aria-disabled", "true");
  button.textContent = root.dataset.starting ?? "";
  const res = await fetch("/api/podcast", {
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
  button.removeAttribute("aria-disabled");
  button.textContent = words;
  if (res?.status === 202 && reply.run_id) {
    const about = run.kind && run.episode ? { kind: run.kind, episode: run.episode } : undefined;
    startRun(reply.run_id, about, run.retry);
    focusCreate();
    return;
  }
  set({ ...run, note: refusal(root, res, reply) || undefined });
}

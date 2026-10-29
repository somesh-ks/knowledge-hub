/**
 * The podcast queue (components/Queue.astro): what is being made, and what was made today, as a
 * browser lists its downloads. It draws the run this browser follows (the record scripts/runStatus.ts
 * keeps), the runs that ended today (lib/queueDay.ts) and, asking GET /api/generations while anything
 * is going, the runs of other devices and tabs too. Below 64rem a dock above the bottom bar, folded
 * to one row or opened to the rows; from 64rem a row in the side column that opens a popover. One
 * list of rows, drawn into both. lib/generations.ts says what each row reads and lib/queueNames.ts
 * what it is called; this file carries only the DOM.
 *
 * Only a Catch up and a regeneration are rows. A run that ended stays for the day (a podcast made
 * with Start listening, a failure with its Details, a stop, a lost run with what can be done about
 * it) until the day changes. The head always says "Podcast queue"; a row says the time left, and its
 * stage is the icon at its end. Every sentence is in the element's data attributes, so this file
 * carries no copy.
 */
import { cancelRun } from "../lib/cancelRun";
import {
  describeGeneration,
  type FollowedRun,
  type GenerationContext,
  type GenerationView,
} from "../lib/generations";
import { DAY_KEY, type DayEntry, isToday, readDay } from "../lib/queueDay";
import { clockTime, type QueueWords, queueNames } from "../lib/queueNames";
import { stageKind } from "../lib/queueStage";
import { GENERATION_STARTED_EVENT, RUN_EVENT, RUN_STORAGE_KEY } from "../lib/runRecord";
import { BRIEFING_STAGES, EPISODE_STAGES } from "../lib/runStages";
import type { GenerationRow, GenerationsResponse } from "../types/contracts";
import { openQueueDetails, type QueueDetails } from "./queueDetails";
import {
  checkAgain,
  listenLive,
  liveHint,
  readRun,
  retry,
  type Stored,
  statusLine,
} from "./runStatus";

/** How often the list asks again while the queue is open, and while it is folded. */
const OPEN_POLL_MS = 4000;
const FOLDED_POLL_MS = 12_000;
/** A run stopped from another device is hidden for this long, in case GitHub still lists it as running. */
const CANCELLED_HIDE_MS = 45_000;
/** The popover opens by itself for a run started here, after the sheet that started it has gone. */
const OPEN_AFTER_START_MS = 450;
/** A swipe this long, in pixels, opens or folds the dock. */
const SWIPE_PX = 32;
/** How long an icon takes to turn out, before it is taken out of the slot. */
const ICON_OUT_MS = 300;
/** The failed run whose row has opened the dock already, kept for the tab so a reload does not open it again. */
const OPENED_KEY = "singularity:queue-opened";
const WIDE = "(width >= 64rem)";

type Ended = "done" | "failed" | "started" | "cancelled";
const ENDED: readonly string[] = ["done", "failed", "started", "cancelled"];
const isEnded = (phase: string): phase is Ended => ENDED.includes(phase);

/** A row: the server's, and what the record says of it when it is this browser's own run. */
interface Item {
  row: GenerationRow;
  /** Set once the run is over: the row stays for the day to say how it ended. */
  ended: Ended | null;
  record: Stored | null;
  /** When it ended (epoch ms), for a run that has. */
  at: number | null;
}

/** What the head shows: how many are going, and how far along they are together. */
interface Head {
  going: number;
  percent: number;
  /** With nothing going: how the day's runs ended. */
  ended: "done" | "failed" | "other" | null;
}

let mounted = false;
let root: HTMLElement | null = null;
let rows: GenerationRow[] = [];
let timer = 0;
let polling = 0;
let refreshing = false;
/** The first time each run was seen in each stage: a run this browser did not start has no clock of its own. */
const stageSeen = new Map<string, number>();
/** Runs of other devices the person stopped, and when: hidden until GitHub agrees. */
const stopped = new Map<number, number>();
/** The furthest each ring has gone, so it never goes back between two answers. */
const furthest = new Map<number, number>();
/** The failed or lost run whose row has opened the dock once already. */
let opened = "";
let announced = "";
let head: Head = { going: 0, percent: 0, ended: null };
/** A run was seen going in this page's life: its end is then worth saying aloud. */
let seenGoing = false;

const dock = (): HTMLElement | null =>
  root?.querySelector<HTMLElement>("[data-queue-dock]") ?? null;
const popover = (): HTMLElement | null =>
  root?.querySelector<HTMLElement>("[data-queue-pop]") ?? null;

function queueWords(element: HTMLElement): QueueWords {
  const { dataset } = element;
  return {
    daily: dataset.wordDaily ?? "",
    weekly: dataset.wordWeekly ?? "",
    podcast: dataset.wordPodcast ?? "",
    catchUp: dataset.wordCatchUp ?? "",
  };
}

const isRows = (value: unknown): value is GenerationRow[] =>
  Array.isArray(value) &&
  value.every(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as GenerationRow).run_id === "number" &&
      typeof (row as GenerationRow).stage === "number" &&
      typeof (row as GenerationRow).stages === "number",
  );

function record(): Stored | null {
  try {
    return readRun(localStorage, sessionStorage);
  } catch {
    return null;
  }
}

function day(): DayEntry<Stored>[] {
  try {
    return readDay<Stored>(localStorage);
  } catch {
    return [];
  }
}

/** A run this browser followed, as the list's rows read it. A removal is not a podcast being made: no row. */
function recordRow(run: Stored): GenerationRow | null {
  if (run.kind === "delete") return null;
  const briefing = run.what === "briefing";
  const replaced = run.retry?.body.replace;
  return {
    run_id: run.id,
    what: briefing ? "briefing" : "episode",
    kind: briefing || run.kind === "regenerate" ? "regenerate" : "catch_up",
    target: run.episode ?? (typeof replaced === "string" ? replaced : null),
    state: run.phase === "queued" ? "queued" : "running",
    started_at: new Date(run.t0 ?? Date.now()).toISOString(),
    stage: run.stage ?? 0,
    stages: run.stages ?? (briefing ? BRIEFING_STAGES.length : EPISODE_STAGES.length),
    label: run.label ?? "",
    ...(run.estimates ? { stage_estimates_ms: run.estimates } : {}),
  };
}

/**
 * What the queue holds now: the runs going (the server's rows, and this browser's own run, which the
 * server may not list yet) and the runs that ended today, newest first, the going ones above.
 */
function currentItems(): Item[] {
  const now = Date.now();
  for (const [id, at] of stopped) if (now - at > CANCELLED_HIDE_MS) stopped.delete(id);
  const run = record();

  // The ones that ended: the record (the freshest word on its run) and the day's list. An ended run
  // is no longer in GitHub's list; what was kept of it is all there is.
  const kept = day();
  const keptAt = new Map(kept.map((entry) => [entry.run.id, entry.at]));
  const finished: Item[] = [];
  const add = (stored: Stored): void => {
    const row = recordRow(stored);
    const at = keptAt.get(stored.id) ?? stored.stageAt ?? stored.t0 ?? 0;
    // A record left from another day is not today's queue.
    if (!row || !isEnded(stored.phase) || !isToday(at, now)) return;
    if (finished.some((item) => item.row.run_id === stored.id)) return;
    finished.push({ row, ended: stored.phase, record: stored, at });
  };
  if (run) add(run);
  for (const entry of kept) add(entry.run);

  // run.yml names a regeneration "regenerate <id>" and the schedule's Daily and Weekly are never listed
  // (D217). A briefing row without a target is a run under the old name "run" or one made by hand, which
  // nobody here asked for: only this browser's own is drawn.
  const going: Item[] = rows
    .filter((row) => !stopped.has(row.run_id) && !finished.some((o) => o.row.run_id === row.run_id))
    .filter((row) => row.what !== "briefing" || row.target !== null || row.run_id === run?.id)
    .map((row) => ({ row, ended: null, record: null, at: null }));
  const own = run && !isEnded(run.phase) ? recordRow(run) : null;
  if (run && own) {
    const index = going.findIndex((item) => item.row.run_id === run.id);
    if (index >= 0)
      going[index] = { row: going[index]?.row ?? own, ended: null, record: run, at: null };
    else if (!stopped.has(run.id)) going.push({ row: own, ended: null, record: run, at: null });
  }
  going.sort((a, b) => Date.parse(b.row.started_at) - Date.parse(a.row.started_at));
  finished.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return [...going, ...finished];
}

function followed(run: Stored | null): FollowedRun | null {
  return run
    ? { id: run.id, stageAt: run.stageAt, t0: run.t0, estimates: run.estimates, retry: run.retry }
    : null;
}

function setText(target: Element | null, text: string): void {
  if (target && target.textContent !== text) target.textContent = text;
}

function fillTemplate(text: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (out, [key, value]) => out.replaceAll(`{${key}}`, value),
    text,
  );
}

const calm = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Puts the icon of `kind` in a slot, or empties it. The icons are in the page (Queue.astro's
 * template), so this carries no paths. A new icon turns in as the old one turns out; under reduced
 * motion it simply replaces it.
 */
function setIcon(slot: Element | null, kind: string | null): void {
  if (!slot || !root) return;
  const element = slot as HTMLElement;
  if ((element.dataset.icon ?? "") === (kind ?? "")) return;
  element.dataset.icon = kind ?? "";
  const source = kind
    ? root
        .querySelector<HTMLTemplateElement>("template[data-queue-icons]")
        ?.content.querySelector(`[data-queue-icon="${kind}"] svg`)
    : null;
  const next = source?.cloneNode(true) as SVGElement | undefined;
  for (const child of [...element.children]) {
    if (next && !calm() && !child.hasAttribute("data-leaving")) {
      child.setAttribute("data-leaving", "");
      window.setTimeout(() => child.remove(), ICON_OUT_MS);
    } else if (!child.hasAttribute("data-leaving")) child.remove();
  }
  if (next) element.append(next);
}

/** The stage a row is in, or how it ended: the words a screen reader hears, and what a row falls back to. */
function statusOf(item: Item, view: GenerationView, data: DOMStringMap): string {
  if (item.ended === "cancelled") return data.cancelled ?? "";
  if (item.ended === "started") return data.started ?? "";
  if ((item.ended === "failed" || item.ended === "done") && item.record) {
    return statusLine(item.record, data);
  }
  // A run that is going but has not named its stage yet says what kind of run it is.
  if (!view.status && view.running && item.record) return statusLine(item.record, data);
  return view.status;
}

/**
 * The one line under a row's name. A run going says the time left (the stage is the icon at the row's
 * end); a run that ended says when, then how: "14:32 · Podcast ready". One line, always.
 */
function subtitleOf(item: Item, view: GenerationView, data: DOMStringMap, stage: string): string {
  if (item.ended) {
    return [item.at ? clockTime(item.at) : "", stage].filter(Boolean).join(" · ");
  }
  if (!view.running) return data.wordWaiting ?? "";
  if (view.eta) return view.eta;
  return view.slow ? (data.wordSlow ?? "") : stage;
}

/** A failed run's Details: what went wrong, and the facts of the run to copy. */
function detailsOf(item: Item, name: string, data: DOMStringMap): QueueDetails | null {
  const run = item.record;
  if (!run) return null;
  const iso = (ms: number | null | undefined): string => (ms ? new Date(ms).toISOString() : "");
  const log = run.log?.startsWith("https://github.com/") ? run.log : "";
  return {
    lede: [statusLine(run, data), run.reason].filter(Boolean).join(" "),
    fields: [
      ["run", String(run.id)],
      ["podcast", name],
      ["step", run.step ?? ""],
      ["stage", run.failedStage ?? run.label ?? ""],
      ["kept", run.kept?.join(", ") ?? ""],
      ["reason", run.reason ?? ""],
      ["started", iso(run.t0)],
      ["ended", iso(item.at)],
      ["log", log],
    ],
    log,
  };
}

function paintRow(
  li: HTMLElement,
  item: Item,
  view: GenerationView,
  name: string,
  data: DOMStringMap,
  current: Stored | null,
): void {
  const { row } = item;
  const going = item.ended === null;
  li.dataset.state = item.ended ?? (view.running ? "running" : "queued");
  setText(li.querySelector("[data-queue-name]"), name);
  setText(
    li.querySelector("[data-queue-note]"),
    row.kind === "regenerate" ? (data.wordRegeneration ?? "") : "",
  );
  const stage = statusOf(item, view, data);
  setText(li.querySelector("[data-queue-stage]"), stage);
  // A row being cancelled says so until the stop lands; a redraw must not take the word away.
  if (!li.hasAttribute("data-cancelling")) {
    setText(li.querySelector("[data-queue-status]"), subtitleOf(item, view, data, stage));
  }

  // The lead: the ring while it goes; once it ended, Start listening when there is a podcast to open,
  // else the icon that says how it ended.
  const ring = li.querySelector<HTMLElement>("[data-queue-ring]");
  const percent = Math.max(view.percent, furthest.get(row.run_id) ?? 0);
  if (going) furthest.set(row.run_id, percent);
  if (ring) {
    ring.hidden = !going;
    ring.style.setProperty("--queue-p", String(percent));
    ring.style.setProperty("--queue-span", `${OPEN_POLL_MS / 1000}s`);
    ring.setAttribute("aria-valuenow", String(percent));
    ring.setAttribute(
      "aria-label",
      fillTemplate(data.wordProgressLabel ?? "", { title: name, pct: String(percent) }),
    );
    setText(ring.querySelector("[data-queue-ring-text]"), going ? `${percent}%` : "");
  }
  const href = item.ended === "done" ? (item.record?.href ?? "") : "";
  const play = li.querySelector<HTMLAnchorElement>("[data-queue-play]");
  if (play) {
    play.hidden = !href;
    if (href && play.getAttribute("href") !== href) play.setAttribute("href", href);
    play.setAttribute("aria-label", fillTemplate(data.wordListenLabel ?? "", { title: name }));
  }
  const endIcon = li.querySelector<HTMLElement>("[data-queue-end-icon]");
  if (endIcon) {
    endIcon.hidden = going || Boolean(href);
    setIcon(endIcon, going || href ? null : item.ended);
  }

  // The stage is the icon at the row's end, which morphs as the run moves on.
  const mark = li.querySelector<HTMLElement>("[data-queue-row-icon]");
  if (mark) {
    setIcon(mark, going ? stageKind(row) : null);
    mark.toggleAttribute("data-live", going);
  }

  const cancel = li.querySelector<HTMLButtonElement>("[data-queue-cancel]");
  if (cancel) {
    cancel.hidden = !(going && view.cancellable);
    cancel.setAttribute("aria-label", fillTemplate(data.wordCancelLabel ?? "", { title: name }));
  }
  const listen = li.querySelector<HTMLElement>("[data-queue-listen]");
  if (listen) listen.hidden = !(going && view.listen);
  // Try again and Check again act on the run on record; an earlier failure of the day is only listed.
  const latest = item.record !== null && item.record.id === current?.id;
  const again = li.querySelector<HTMLElement>("[data-queue-retry]");
  if (again) again.hidden = !(item.ended === "failed" && item.record?.retry && latest);
  const check = li.querySelector<HTMLElement>("[data-queue-check]");
  if (check) check.hidden = !(item.ended === "started" && latest);
  const details = li.querySelector<HTMLElement>("[data-queue-details]");
  if (details) details.hidden = !(item.ended === "failed" && item.record);
  li.toggleAttribute("data-cancelling", li.hasAttribute("data-cancelling") && going);
}

/** Draw the rows into a list, keeping the nodes of rows that stay, so a press on one is not lost to a redraw. */
function paintList(
  list: HTMLElement,
  template: HTMLTemplateElement,
  entries: { item: Item; view: GenerationView; name: string }[],
  data: DOMStringMap,
  current: Stored | null,
): void {
  const present = new Map(
    [...list.querySelectorAll<HTMLElement>("[data-queue-row-item]")].map((li) => [
      li.dataset.run,
      li,
    ]),
  );
  for (const { item, view, name } of entries) {
    const key = String(item.row.run_id);
    let li = present.get(key);
    if (!li) {
      const fresh = template.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
      if (!fresh) continue;
      fresh.dataset.run = key;
      li = fresh;
      list.append(li);
    }
    present.delete(key);
    paintRow(li, item, view, name, data, current);
  }
  for (const gone of present.values()) gone.remove();
  // The order is the entries': going first, then the day's, the newest first.
  for (const { item } of entries) {
    const li = list.querySelector<HTMLElement>(`[data-run="${item.row.run_id}"]`);
    if (li) list.append(li);
  }
}

/** What the side column's row shows: "Podcast queue" with the ring while it goes, a check or an alert once it is over. */
let lastTrigger = { shown: false, title: "", percent: 0, ended: "", live: false };

/** The foot of the side column. The navigation is redrawn on every page, so this also runs after a swap. */
function paintTrigger(): void {
  const trigger = document.querySelector<HTMLElement>("[data-queue-trigger]");
  if (!trigger) return;
  trigger.hidden = !lastTrigger.shown;
  const title = trigger.querySelector<HTMLElement>("[data-queue-trigger-title]");
  setText(title, lastTrigger.title);
  title?.toggleAttribute("data-live", lastTrigger.live);
  const ring = trigger.querySelector<HTMLElement>("[data-queue-trigger-ring]");
  ring?.style.setProperty("--queue-p", String(lastTrigger.percent));
  ring?.style.setProperty("--queue-span", `${OPEN_POLL_MS / 1000}s`);
  if (ring) {
    if (lastTrigger.ended) ring.dataset.ended = lastTrigger.ended;
    else delete ring.dataset.ended;
  }
  // The ring alone while it goes; a check, or what went wrong, once it is over.
  setIcon(ring?.querySelector("[data-queue-head-icon]") ?? null, endIconOf(lastTrigger.ended));
}

const endIconOf = (ended: string): string | null =>
  ended === "done" ? "done" : ended === "failed" ? "failed" : ended ? "cancelled" : null;

function context(): GenerationContext {
  const run = record();
  const live = liveHint();
  const data = (root as HTMLElement).dataset;
  return {
    now: Date.now(),
    words: {
      waiting: data.wordWaiting ?? "",
      left: data.wordLeft ?? "",
      slow: data.wordSlow ?? "",
    },
    followed: followed(run),
    live,
    stageSince: (id, stage) => stageSeen.get(`${id}:${stage}`),
  };
}

/** Folds the dock and keeps the page's room for it as tall as it is. */
function setExpanded(open: boolean): void {
  const panel = dock();
  if (!panel) return;
  panel.toggleAttribute("data-expanded", open);
  const toggle = panel.querySelector<HTMLElement>("[data-queue-toggle]");
  toggle?.setAttribute("aria-expanded", String(open));
  toggle?.setAttribute(
    "aria-label",
    (open ? root?.dataset.wordCollapse : root?.dataset.wordExpand) ?? "",
  );
  syncPolling();
}

/** The head, from `head`: the dock's folded row and the side column's row. */
function applyHead(): void {
  if (!root) return;
  const title = root.dataset.wordTitle ?? "";
  const live = head.going > 0;
  const percent = live ? `${head.percent}%` : "";
  const ended = live
    ? ""
    : head.ended === "failed"
      ? "failed"
      : head.ended === "done"
        ? "done"
        : head.ended
          ? "other"
          : "";

  const panel = dock();
  if (panel) {
    const label = panel.querySelector<HTMLElement>("[data-queue-title]");
    setText(label, title);
    label?.toggleAttribute("data-live", live);
    setText(panel.querySelector("[data-queue-percent]"), percent);
    const ring = panel.querySelector<HTMLElement>("[data-queue-fold-ring]");
    ring?.style.setProperty("--queue-p", String(head.percent));
    ring?.style.setProperty("--queue-span", `${OPEN_POLL_MS / 1000}s`);
    if (ring) {
      if (ended) ring.dataset.ended = ended;
      else delete ring.dataset.ended;
    }
    // The ring alone while it goes; a check, or what went wrong, once it is over.
    setIcon(panel.querySelector("[data-queue-head-icon]"), endIconOf(ended));
  }
  lastTrigger = { shown: dock()?.hidden === false, title, percent: head.percent, ended, live };
  paintTrigger();
}

function openedBefore(): string {
  try {
    return sessionStorage.getItem(OPENED_KEY) ?? "";
  } catch {
    return opened;
  }
}

function render(): void {
  if (!root?.isConnected) return;
  const data = root.dataset;
  const items = currentItems();
  const base = context();
  for (const { row } of items) {
    const key = `${row.run_id}:${row.stage}`;
    if (!stageSeen.has(key)) stageSeen.set(key, base.now);
  }
  const names = queueNames(
    items.map((item) => item.row),
    queueWords(root),
  );
  const entries = items.map((item, index) => ({
    item,
    view: describeGeneration(item.row, base),
    name: names[index] ?? "",
  }));
  const template = root.querySelector<HTMLTemplateElement>("template[data-queue-row]");
  if (template) {
    const current = record();
    for (const list of root.querySelectorAll<HTMLElement>("[data-queue-list]")) {
      paintList(list, template, entries, data, current);
    }
  }
  for (const id of furthest.keys())
    if (!items.some((item) => item.row.run_id === id)) furthest.delete(id);

  // The head: how many are going, in which stage, and how far along; once none is, how the day went.
  const going = entries.filter(({ item }) => item.ended === null);
  const failed = entries.some(({ item }) => item.ended === "failed" || item.ended === "started");
  const lead = going[0];
  const percents = going.map(({ item, view }) =>
    Math.max(view.percent, furthest.get(item.row.run_id) ?? 0),
  );
  head = {
    going: going.length,
    percent: percents.length
      ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length)
      : 0,
    ended:
      going.length > 0 || entries.length === 0
        ? null
        : failed
          ? "failed"
          : entries.some(({ item }) => item.ended === "done")
            ? "done"
            : "other",
  };

  const panel = dock();
  if (panel) panel.hidden = entries.length === 0;
  applyHead();

  // The page keeps room for the dock (shell.css, --run-room), and the whole page knows a run is up.
  const page = document.documentElement;
  const first = entries[0];
  if (first) page.dataset.run = first.item.ended ?? (first.view.running ? "running" : "queued");
  else delete page.dataset.run;
  keepRoom();

  // A failed or lost run opens the dock once, so its whole sentence reads on a phone. The reader can
  // fold it again: it opens once for each run.
  const alarm = entries.find(({ item }) => item.ended === "failed" || item.ended === "started");
  const alarmKey = alarm ? `${alarm.item.row.run_id}:${alarm.item.ended}` : "";
  if (alarmKey && alarmKey !== openedBefore() && alarmKey !== opened) {
    opened = alarmKey;
    try {
      sessionStorage.setItem(OPENED_KEY, alarmKey);
    } catch {
      // Without storage it opens again on the next page.
    }
    setExpanded(true);
  }
  if (entries.length === 0) {
    setExpanded(false);
    const pop = popover();
    if (pop?.matches(":popover-open")) pop.hidePopover();
  }

  // A screen reader hears the stage, or how a run ended, and only when it changes (not at every percent).
  // An end is said for a run seen going on this page, or one that failed; a page opened later stays quiet about a podcast made earlier.
  if (lead) seenGoing = true;
  const newest = entries[0];
  const said = lead
    ? lead.view.status
    : alarm
      ? statusOf(alarm.item, alarm.view, data)
      : seenGoing && newest
        ? statusOf(newest.item, newest.view, data)
        : "";
  const region = root.querySelector("[data-run-announce]");
  if (region && said !== announced) {
    announced = said;
    region.textContent = said;
  }
  syncPolling();
}

/** Below 64rem the dock is on top of the page's foot: its height is the room the page keeps. */
let watching: ResizeObserver | null = null;
function keepRoom(): void {
  const panel = dock();
  const page = document.documentElement;
  const wide = matchMedia(WIDE).matches;
  if (!panel || panel.hidden || wide) {
    page.style.removeProperty("--run-room");
    return;
  }
  const measure = () =>
    page.style.setProperty("--run-room", `${Math.ceil(panel.getBoundingClientRect().height)}px`);
  measure();
  if (!watching && typeof ResizeObserver === "function") {
    watching = new ResizeObserver(measure);
    watching.observe(panel);
  }
}

async function refresh(): Promise<void> {
  if (refreshing || document.hidden) return;
  refreshing = true;
  try {
    const response = await fetch("/api/generations", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as Partial<GenerationsResponse>;
    if (!isRows(body.generations)) throw new Error("not a list");
    rows = body.generations;
  } catch {
    // The record still draws this browser's own run; the other devices' wait for the next answer.
  } finally {
    refreshing = false;
  }
  render();
}

/**
 * Asking costs GitHub calls: only while a run is going, often when the queue is open, seldom when
 * folded. The day's finished rows are this browser's own record and cost nothing to keep.
 */
function syncPolling(): void {
  const showing = currentItems().some((item) => item.ended === null);
  const open = Boolean(
    dock()?.hasAttribute("data-expanded") || popover()?.matches(":popover-open"),
  );
  const wanted = showing ? (open ? OPEN_POLL_MS : FOLDED_POLL_MS) : 0;
  if (wanted === polling) return;
  clearInterval(timer);
  polling = wanted;
  if (!wanted) {
    rows = [];
    return;
  }
  void refresh();
  timer = window.setInterval(() => void refresh(), wanted);
}

async function stop(button: HTMLButtonElement): Promise<void> {
  const li = button.closest<HTMLElement>("[data-queue-row-item]");
  const id = Number(li?.dataset.run);
  if (!li || !Number.isFinite(id) || !root) return;
  const status = li.querySelector<HTMLElement>("[data-queue-status]");
  const before = status?.textContent ?? "";
  li.setAttribute("data-cancelling", "");
  button.disabled = true;
  if (status) status.textContent = root.dataset.cancelling ?? "";
  const result = await cancelRun(id);
  if (result === "failed") {
    li.removeAttribute("data-cancelling");
    button.disabled = false;
    if (status) status.textContent = root.dataset.cancelFailed ?? before;
    return;
  }
  button.disabled = false;
  // This browser's own run says so itself on its next poll and stays as Cancelled; another device's
  // is simply gone.
  if (record()?.id !== id) stopped.set(id, Date.now());
  // A run that had already ended is not in the queue any more, whoever's it was.
  if (result === "finished") rows = rows.filter((row) => row.run_id !== id);
  furthest.delete(id);
  render();
}

/** Swipe up on the dock opens it, swipe down folds it; a tap on the head does the same. */
function bindSwipe(panel: HTMLElement): void {
  let startY = 0;
  let tracking = false;
  panel.addEventListener(
    "touchstart",
    (event) => {
      tracking = event.touches.length === 1;
      startY = event.touches[0]?.clientY ?? 0;
    },
    { passive: true },
  );
  panel.addEventListener(
    "touchend",
    (event) => {
      if (!tracking) return;
      tracking = false;
      const dy = (event.changedTouches[0]?.clientY ?? startY) - startY;
      const list = panel.querySelector<HTMLElement>(".queue-list");
      if (dy <= -SWIPE_PX) setExpanded(true);
      // A swipe down inside a list that has scrolled is the list's, not the dock's.
      else if (dy >= SWIPE_PX && (list?.scrollTop ?? 0) === 0) setExpanded(false);
    },
    { passive: true },
  );
}

export function mountQueue(startedHere = false): void {
  const found = document.querySelector<HTMLElement>("[data-queue]");
  if (!found) return;
  root = found;
  const openForNewRun = (): void => {
    if (!matchMedia(WIDE).matches) return;
    window.setTimeout(() => {
      const target = popover();
      if (
        target?.isConnected &&
        !target.matches(":popover-open") &&
        currentItems().some((item) => item.ended === null)
      ) {
        target.showPopover?.();
      }
    }, OPEN_AFTER_START_MS);
  };
  if (mounted) {
    render();
    // A run started here while the queue was mounting for an older record: the first mount did not open for it.
    if (startedHere) openForNewRun();
    return;
  }
  mounted = true;

  const panel = dock();
  if (panel) bindSwipe(panel);

  root.addEventListener("click", (event) => {
    const target = event.target as Element;
    const button = (selector: string) => target.closest<HTMLButtonElement>(selector);
    if (target.closest("[data-queue-toggle]")) {
      setExpanded(!dock()?.hasAttribute("data-expanded"));
      return;
    }
    const cancel = button("[data-queue-cancel]");
    if (cancel) void stop(cancel);
    if (target.closest("[data-queue-retry]")) void retry();
    if (target.closest("[data-queue-check]")) checkAgain();
    if (target.closest("[data-queue-details]")) {
      const li = target.closest<HTMLElement>("[data-queue-row-item]");
      const item = currentItems().find((entry) => String(entry.row.run_id) === li?.dataset.run);
      const name = [
        li?.querySelector("[data-queue-name]")?.textContent,
        li?.querySelector("[data-queue-note]")?.textContent,
      ]
        .filter(Boolean)
        .join(" ");
      const details = item ? detailsOf(item, name, root?.dataset ?? {}) : null;
      if (details) {
        popover()?.hidePopover?.();
        openQueueDetails(details, root?.dataset ?? {});
      }
    }
    if (target.closest("[data-queue-listen]")) {
      popover()?.hidePopover?.();
      void listenLive();
    }
    // Start listening is a link to the podcast: the queue gets out of its way.
    if (target.closest("[data-queue-play]")) {
      popover()?.hidePopover?.();
      setExpanded(false);
    }
    if (target.closest("[data-create-open]")) popover()?.hidePopover?.();
  });
  // Folding the dock with the keyboard: Escape, as every other surface closes.
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dock()?.hasAttribute("data-expanded")) setExpanded(false);
  });

  const pop = popover();
  pop?.addEventListener("toggle", () => {
    render();
    syncPolling();
  });

  // The run on record changed: the rows are drawn again.
  document.addEventListener(RUN_EVENT, render);
  // Another tab ended a run.
  window.addEventListener("storage", (event) => {
    if (event.key === DAY_KEY || event.key === RUN_STORAGE_KEY) render();
  });
  // The navigation is redrawn on every page: its row is put back before the page is painted.
  document.addEventListener("astro:after-swap", paintTrigger);
  document.addEventListener("astro:page-load", () => {
    mountQueue();
  });
  matchMedia(WIDE).addEventListener("change", () => {
    keepRoom();
  });
  // A run was started here. On a wide screen the popover opens to show it, once the sheet that
  // started it has gone, as a browser shows a download it has begun.
  document.addEventListener(GENERATION_STARTED_EVENT, openForNewRun);
  // The first run of a page's life began before this script was loaded to hear it.
  if (startedHere) openForNewRun();

  render();
}

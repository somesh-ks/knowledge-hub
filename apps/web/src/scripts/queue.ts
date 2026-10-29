/**
 * The podcast queue (components/Queue.astro): what is being made, as a browser lists its downloads.
 * It draws the run this browser follows (the record scripts/runStatus.ts keeps) and, asking
 * GET /api/generations while anything shows, the runs of other devices and tabs too. Below 64rem a
 * dock above the bottom bar, folded to one row or opened to the rows; from 64rem a row in the side
 * column that opens a popover. One list of rows, drawn into both. lib/generations.ts says what each
 * row reads and lib/queueNames.ts what it is called; this file carries only the DOM.
 *
 * Only a Catch up and a regeneration are rows. A run that finished leaves the queue (a toast says it
 * did, sheets/runEndToast.ts); one that failed, was lost or was cancelled stays, with what can be done
 * about it, until it is dismissed. Every sentence is in the element's data attributes, so this file
 * carries no copy.
 */
import { cancelRun } from "../lib/cancelRun";
import {
  describeGeneration,
  type FollowedRun,
  type GenerationContext,
  type GenerationView,
} from "../lib/generations";
import { type QueueWords, queueNames } from "../lib/queueNames";
import { GENERATION_STARTED_EVENT, RUN_EVENT } from "../lib/runRecord";
import type { GenerationRow, GenerationsResponse } from "../types/contracts";
import {
  checkAgain,
  dismiss,
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
const WIDE = "(width >= 64rem)";

/** A row: the server's, and what the record says of it when it is this browser's own run. */
interface Item {
  row: GenerationRow;
  /** Set once the run is over without a podcast: the row stays to say so. */
  ended: "failed" | "started" | "cancelled" | null;
  record: Stored | null;
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

/** The run this browser follows, as the list's rows read it. A removal is not a podcast being made: no row. */
function recordRow(run: Stored): GenerationRow | null {
  if (run.kind === "delete" || run.phase === "done") return null;
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
    stages: run.stages ?? (briefing ? 7 : 3),
    label: run.label ?? "",
    ...(run.estimates ? { stage_estimates_ms: run.estimates } : {}),
  };
}

/** What the queue holds now: the server's rows, and this browser's own run, which the server may not list yet or any more. */
function currentItems(): Item[] {
  const now = Date.now();
  for (const [id, at] of stopped) if (now - at > CANCELLED_HIDE_MS) stopped.delete(id);
  const run = record();
  // run.yml names every dispatched run "run", so a briefing run from another device cannot be told from
  // the schedule's Daily or Weekly, which are never listed. Only this browser's own is drawn until
  // run.yml names a regeneration "regenerate <id>" (D217).
  const items: Item[] = rows
    .filter((row) => !stopped.has(row.run_id))
    .filter((row) => row.what !== "briefing" || row.target !== null || row.run_id === run?.id)
    .map((row) => ({ row, ended: null, record: null }));
  const own = run ? recordRow(run) : null;
  if (run && own) {
    const ended =
      run.phase === "failed" || run.phase === "started" || run.phase === "cancelled"
        ? run.phase
        : null;
    const index = items.findIndex((item) => item.row.run_id === run.id);
    // An ended run is no longer in GitHub's list; the record is all there is of it.
    if (index >= 0 && !ended) items[index] = { row: items[index]?.row ?? own, ended, record: run };
    else if (ended || !stopped.has(run.id)) {
      if (index >= 0) items.splice(index, 1);
      items.push({ row: own, ended, record: run });
    }
  }
  // The newest first, as a downloads list has it.
  return items.sort((a, b) => Date.parse(b.row.started_at) - Date.parse(a.row.started_at));
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

/** What a row says under its name: the stage, or why it ended. */
function statusOf(item: Item, view: GenerationView, data: DOMStringMap): string {
  if (item.ended === "cancelled") return data.cancelled ?? "";
  if (item.ended === "started") return data.started ?? "";
  if (item.ended === "failed" && item.record) return statusLine(item.record, data);
  // A run that is going but has not named its stage yet says what kind of run it is.
  if (!view.status && view.running && item.record) return statusLine(item.record, data);
  return view.status;
}

function paintRow(
  li: HTMLElement,
  item: Item,
  view: GenerationView,
  name: string,
  data: DOMStringMap,
): void {
  const { row } = item;
  const going = item.ended === null;
  li.dataset.state = item.ended ?? (view.running ? "running" : "queued");
  setText(li.querySelector("[data-queue-name]"), name);
  setText(li.querySelector("[data-queue-eta]"), going ? view.eta : "");
  // A row being cancelled says so until the stop lands; a redraw must not take the word away.
  if (!li.hasAttribute("data-cancelling")) {
    setText(li.querySelector("[data-queue-status]"), statusOf(item, view, data));
  }

  // The ring: only for a run that is going; one that ended has its dismiss in the ring's place.
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

  const cancel = li.querySelector<HTMLButtonElement>("[data-queue-cancel]");
  if (cancel) {
    cancel.hidden = !(going && view.cancellable);
    cancel.setAttribute("aria-label", fillTemplate(data.wordCancelLabel ?? "", { title: name }));
  }
  const listen = li.querySelector<HTMLElement>("[data-queue-listen]");
  if (listen) listen.hidden = !(going && view.listen);
  const again = li.querySelector<HTMLElement>("[data-queue-retry]");
  if (again) again.hidden = !(item.ended === "failed" && item.record?.retry);
  const check = li.querySelector<HTMLElement>("[data-queue-check]");
  if (check) check.hidden = item.ended !== "started";
  const details = li.querySelector<HTMLAnchorElement>("[data-queue-details]");
  if (details) {
    const href =
      item.ended === "failed" && item.record?.log?.startsWith("https://github.com/")
        ? item.record.log
        : "";
    if (href && details.getAttribute("href") !== href) details.setAttribute("href", href);
    details.hidden = !href;
  }
  const close = li.querySelector<HTMLButtonElement>("[data-queue-dismiss]");
  if (close) {
    close.hidden = going;
    close.setAttribute("aria-label", fillTemplate(data.wordDismissLabel ?? "", { title: name }));
  }

  const thumb = li.querySelector<HTMLElement>(".queue-thumb");
  if (thumb) {
    if (view.tint) thumb.style.setProperty("--queue-tint", view.tint);
    else thumb.style.removeProperty("--queue-tint");
    thumb.toggleAttribute("data-tinted", Boolean(view.tint));
    const image = thumb.querySelector<HTMLImageElement>(".queue-thumb-img");
    if (image && view.cover && image.dataset.src !== view.cover) {
      image.dataset.src = view.cover;
      image.hidden = true;
      image.addEventListener("load", () => (image.hidden = false), { once: true });
      image.addEventListener("error", () => (image.hidden = true), { once: true });
      image.src = view.cover;
    }
    const badge = thumb.querySelector<HTMLElement>("[data-queue-badge]");
    if (badge) badge.hidden = row.kind !== "regenerate";
  }
  li.toggleAttribute("data-cancelling", li.hasAttribute("data-cancelling") && going);
}

/** Draw the rows into a list, keeping the nodes of rows that stay, so a press on one is not lost to a redraw. */
function paintList(
  list: HTMLElement,
  template: HTMLTemplateElement,
  entries: { item: Item; view: GenerationView; name: string }[],
  data: DOMStringMap,
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
    paintRow(li, item, view, name, data);
  }
  for (const gone of present.values()) gone.remove();
  // The order is the entries': the newest first.
  for (const { item } of entries) {
    const li = list.querySelector<HTMLElement>(`[data-run="${item.row.run_id}"]`);
    if (li) list.append(li);
  }
}

let lastTrigger = { shown: false, title: "", percent: "" };

/** The foot of the side column. The navigation is redrawn on every page, so this also runs after a swap. */
function paintTrigger(): void {
  const trigger = document.querySelector<HTMLElement>("[data-queue-trigger]");
  if (!trigger) return;
  trigger.hidden = !lastTrigger.shown;
  setText(trigger.querySelector("[data-queue-trigger-title]"), lastTrigger.title);
  setText(trigger.querySelector("[data-queue-trigger-percent]"), lastTrigger.percent);
}

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
    for (const list of root.querySelectorAll<HTMLElement>("[data-queue-list]")) {
      paintList(list, template, entries, data);
    }
  }
  for (const id of furthest.keys())
    if (!items.some((item) => item.row.run_id === id)) furthest.delete(id);

  // The head: how many are being made, and how far along when it is one.
  const going = entries.filter(({ item }) => item.ended === null);
  const failed = entries.some(({ item }) => item.ended === "failed" || item.ended === "started");
  const lead = going[0];
  let title = data.wordHeadEnded ?? "";
  // The side column's row is narrower than the dock's: shorter words for the same states.
  let navTitle = title;
  let percent = "";
  if (going.length === 1 && lead) {
    title = data.wordHeadOne ?? "";
    navTitle = data.wordNavOne ?? "";
    percent = `${Math.max(lead.view.percent, furthest.get(lead.item.row.run_id) ?? 0)}%`;
  } else if (going.length > 1) {
    title = fillTemplate(data.wordHeadMany ?? "", { n: String(going.length) });
    navTitle = fillTemplate(data.wordNavMany ?? "", { n: String(going.length) });
  } else if (failed) {
    title = data.wordHeadFailed ?? "";
    navTitle = data.wordNavFailed ?? "";
  }

  const panel = dock();
  if (panel) {
    panel.hidden = entries.length === 0;
    setText(panel.querySelector("[data-queue-title]"), title);
    setText(panel.querySelector("[data-queue-percent]"), percent);
  }
  lastTrigger = { shown: entries.length > 0, title: navTitle, percent };
  paintTrigger();

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
  if (alarmKey && alarmKey !== opened) {
    opened = alarmKey;
    setExpanded(true);
  }
  if (entries.length === 0) {
    setExpanded(false);
    const pop = popover();
    if (pop?.matches(":popover-open")) pop.hidePopover();
  }

  // A screen reader hears the head and the stage, and only when they change (not at every percent).
  const said = lead ? `${title}. ${lead.view.status}` : failed || entries.length > 0 ? title : "";
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

/** Asking costs GitHub calls: only while something shows, often when the queue is open, seldom when folded. */
function syncPolling(): void {
  const showing = currentItems().length > 0;
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
  if (mounted) {
    render();
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
    if (target.closest("[data-queue-dismiss]")) dismiss();
    if (target.closest("[data-queue-listen]")) {
      popover()?.hidePopover?.();
      void listenLive();
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
  const openForNewRun = (): void => {
    if (!matchMedia(WIDE).matches) return;
    window.setTimeout(() => {
      const target = popover();
      if (target?.isConnected && !target.matches(":popover-open") && currentItems().length > 0) {
        target.showPopover?.();
      }
    }, OPEN_AFTER_START_MS);
  };
  document.addEventListener(GENERATION_STARTED_EVENT, openForNewRun);
  // The first run of a page's life began before this script was loaded to hear it.
  if (startedHere) openForNewRun();

  render();
}

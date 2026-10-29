/**
 * The generations list (components/GenerationsMenu.astro): what is being made, as a browser lists its
 * downloads. While the panel is open it asks GET /api/generations every few seconds and draws one
 * row for each run (lib/generations.ts says what each row reads); the icon's ring follows the run this
 * browser started, from its own record, with no request at all. A row's Cancel asks POST /api/cancel
 * (lib/cancelRun.ts), and Listen now plays the episode's live copy through the run indicator.
 *
 * Every sentence is in the panel's data attributes, so this file carries no copy. The panel is a
 * popover: opening, closing, light dismiss and Escape are the browser's.
 */
import { cancelRun } from "../lib/cancelRun";
import {
  describeGeneration,
  type FollowedRun,
  type GenerationContext,
  type GenerationView,
  type GenerationWords,
} from "../lib/generations";
import { GENERATION_STARTED_EVENT, RUN_EVENT, readRunRecord } from "../lib/runRecord";
import type { GenerationRow, GenerationsResponse } from "../types/contracts";
import { pullToDismiss } from "./pullDismiss";

/** How often the open list asks again. */
const OPEN_POLL_MS = 4000;
/** A cancelled run is hidden from the list for this long, in case GitHub still lists it as running. */
const CANCELLED_HIDE_MS = 45_000;
/** The panel opens by itself for a run started here, after the sheet that started it has gone. */
const OPEN_AFTER_START_MS = 450;
const WIDE = "(width >= 64rem)";

let mounted = false;
let panel: HTMLElement | null = null;
let rows: GenerationRow[] = [];
let loaded = false;
let failed = false;
let timer = 0;
let refreshing = false;
/** The first time each run was seen in each stage: a run this browser did not start has no clock of its own. */
const stageSeen = new Map<string, number>();
/** Runs the person stopped, and when: hidden until GitHub agrees. */
const stopped = new Map<number, number>();
/** The furthest each bar has gone, so it never goes back between two answers. */
const furthest = new Map<number, number>();
let announced = -1;

const find = <T extends HTMLElement>(selector: string): T | null =>
  panel?.querySelector<T>(selector) ?? null;

function wordsOf(element: HTMLElement): GenerationWords {
  const { dataset } = element;
  return {
    waiting: dataset.wordWaiting ?? "",
    left: dataset.wordLeft ?? "",
    slow: dataset.wordSlow ?? "",
    episode: dataset.wordEpisode ?? "",
    briefing: dataset.wordBriefing ?? "",
    regenerate: dataset.wordRegenerate ?? "",
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

/** The run record this browser keeps, in the shape a row reads. */
function followedRun(): FollowedRun | null {
  const run = readRunRecord(() => localStorage);
  return run && typeof run.id === "number"
    ? { id: run.id, stageAt: run.stageAt, t0: run.t0, estimates: run.estimates, retry: run.retry }
    : null;
}

/** The run on record as a row, for a run that is going and the list has not shown yet (GitHub lags a start by seconds). */
function rowFromRecord(): GenerationRow | null {
  const run = readRunRecord(() => localStorage);
  if (!run || typeof run.id !== "number") return null;
  if (run.phase !== "queued" && run.phase !== "running") return null;
  const replaced = run.retry?.body.replace;
  const target = run.episode ?? (typeof replaced === "string" ? replaced : null);
  return {
    run_id: run.id,
    what: run.what === "briefing" ? "briefing" : "episode",
    kind: run.what === "briefing" || run.kind === "regenerate" ? "regenerate" : "catch_up",
    target,
    state: run.phase === "queued" ? "queued" : "running",
    started_at: new Date(run.t0 ?? Date.now()).toISOString(),
    stage: run.stage ?? 0,
    stages: run.stages ?? (run.what === "briefing" ? 7 : 3),
    label: run.label ?? "",
  };
}

async function context(): Promise<GenerationContext> {
  const live = await import("./runStatus").then((module) => module.liveHint()).catch(() => null);
  return {
    now: Date.now(),
    words: wordsOf(panel as HTMLElement),
    followed: followedRun(),
    live,
    stageSince: (id, stage) => stageSeen.get(`${id}:${stage}`),
  };
}

/** What the list holds now: the server's rows, plus the run on record when the server has not listed it yet. */
function currentRows(): GenerationRow[] {
  const now = Date.now();
  for (const [id, at] of stopped) if (now - at > CANCELLED_HIDE_MS) stopped.delete(id);
  const listed = rows.filter((row) => !stopped.has(row.run_id));
  const own = rowFromRecord();
  const all =
    own && !listed.some((row) => row.run_id === own.run_id) && !stopped.has(own.run_id)
      ? [...listed, own]
      : listed;
  // The newest first, as a downloads list has it.
  return all.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

function paintRow(item: HTMLElement, view: GenerationView, words: HTMLElement["dataset"]): void {
  const set = (selector: string, text: string) => {
    const target = item.querySelector<HTMLElement>(selector);
    if (target && target.textContent !== text) target.textContent = text;
  };
  set("[data-gen-title]", view.title);
  const busy = item.hasAttribute("data-cancelling");
  if (!busy) set("[data-gen-meta]", view.meta);

  const bar = item.querySelector<HTMLElement>("[data-gen-bar]");
  const progress = Math.max(view.progress, furthest.get(view.id) ?? 0);
  furthest.set(view.id, progress);
  if (bar) {
    bar.style.setProperty("--gen-to", progress.toFixed(3));
    bar.style.setProperty("--gen-span", `${OPEN_POLL_MS / 1000}s`);
    bar.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
    bar.setAttribute("aria-label", (words.wordProgressLabel ?? "").replace("{title}", view.title));
  }
  const cancel = item.querySelector<HTMLButtonElement>("[data-gen-cancel]");
  cancel?.setAttribute("aria-label", (words.wordCancelLabel ?? "").replace("{title}", view.title));

  const thumb = item.querySelector<HTMLElement>(".gen-thumb");
  if (thumb) {
    if (view.tint) thumb.style.setProperty("--gen-tint", view.tint);
    else thumb.style.removeProperty("--gen-tint");
    thumb.toggleAttribute("data-tinted", Boolean(view.tint));
    const image = thumb.querySelector<HTMLImageElement>(".gen-thumb-img");
    if (image && view.cover && image.dataset.src !== view.cover) {
      image.dataset.src = view.cover;
      image.hidden = true;
      image.addEventListener("load", () => (image.hidden = false), { once: true });
      image.addEventListener("error", () => (image.hidden = true), { once: true });
      image.src = view.cover;
    }
  }
  const listen = item.querySelector<HTMLElement>("[data-gen-listen]");
  if (listen) listen.hidden = !view.listen;
}

async function render(): Promise<void> {
  if (!panel?.isConnected) return;
  const list = find<HTMLElement>("[data-gen-list]");
  const template = find<HTMLTemplateElement>("template[data-gen-row]");
  if (!list || !template) return;
  const wanted = currentRows();
  const base = await context();
  const now = base.now;
  for (const row of wanted) {
    const key = `${row.run_id}:${row.stage}`;
    if (!stageSeen.has(key)) stageSeen.set(key, now);
  }
  const views = wanted.map((row) => describeGeneration(row, base));

  const present = new Map(
    [...list.querySelectorAll<HTMLElement>("[data-gen]")].map((item) => [item.dataset.gen, item]),
  );
  for (const view of views) {
    let item = present.get(String(view.id));
    if (!item) {
      const fresh = template.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
      if (!fresh) continue;
      fresh.dataset.gen = String(view.id);
      item = fresh;
      list.append(item);
    }
    present.delete(String(view.id));
    paintRow(item, view, (panel as HTMLElement).dataset);
  }
  for (const gone of present.values()) gone.remove();
  // The order is the views': the newest first.
  for (const view of views) {
    const item = list.querySelector<HTMLElement>(`[data-gen="${view.id}"]`);
    if (item) list.append(item);
  }

  const none = views.length === 0;
  const checking = find<HTMLElement>("[data-gen-checking]");
  const empty = find<HTMLElement>("[data-gen-empty]");
  const note = find<HTMLElement>("[data-gen-note]");
  if (checking) checking.hidden = loaded || !none;
  if (empty) empty.hidden = !(loaded && none && !failed);
  if (note) {
    note.hidden = !(failed && none);
    note.textContent = failed && none ? (panel.dataset.wordUnavailable ?? "") : "";
  }

  const announce = find<HTMLElement>("[data-gen-announce]");
  if (announce && announced !== views.length && loaded) {
    announced = views.length;
    announce.textContent =
      views.length === 0
        ? ""
        : (panel.dataset.wordLabelBusy ?? "").replace("{n}", String(views.length));
  }
  await syncRing(views);
}

/** The icon: its ring fills with the progress of the run in front, and its name says how many are going. */
async function syncRing(views?: GenerationView[]): Promise<void> {
  const trigger = document.querySelector<HTMLElement>("[data-gen-trigger]");
  if (!trigger || !panel) return;
  let shown = views;
  if (!shown) {
    const own = rowFromRecord();
    shown = own ? [describeGeneration(own, await context())] : [];
  }
  const lead = shown[0];
  const label = panel.dataset.wordLabel ?? "";
  trigger.toggleAttribute("data-active", Boolean(lead));
  trigger.style.setProperty("--gen-p", String(Math.round((lead?.progress ?? 0) * 100)));
  trigger.setAttribute(
    "aria-label",
    shown.length > 0
      ? (panel.dataset.wordLabelBusy ?? label).replace("{n}", String(shown.length))
      : label,
  );
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
    failed = false;
  } catch {
    failed = true;
  } finally {
    refreshing = false;
    loaded = true;
  }
  await render();
}

function startPolling(): void {
  stopPolling();
  void refresh();
  timer = window.setInterval(() => void refresh(), OPEN_POLL_MS);
}

function stopPolling(): void {
  clearInterval(timer);
  timer = 0;
}

/** Without anchor positioning the panel is placed from the icon's, or the strip's, box. */
function place(): void {
  if (!panel || CSS.supports("top", "anchor(bottom)")) return;
  const anchor = [
    ...document.querySelectorAll<HTMLElement>("[data-gen-trigger], [data-run-queue]"),
  ].find((candidate) => candidate.getClientRects().length > 0);
  const box = anchor?.getBoundingClientRect();
  if (!box) return;
  panel.style.setProperty("--menu-top", `${box.bottom + 8}px`);
  panel.style.setProperty("--menu-left", `${box.left}px`);
}

async function stop(button: HTMLButtonElement): Promise<void> {
  const item = button.closest<HTMLElement>("[data-gen]");
  const id = Number(item?.dataset.gen);
  if (!item || !Number.isFinite(id) || !panel) return;
  const meta = item.querySelector<HTMLElement>("[data-gen-meta]");
  const before = meta?.textContent ?? "";
  item.setAttribute("data-cancelling", "");
  button.disabled = true;
  if (meta) meta.textContent = panel.dataset.wordCancelling ?? "";
  const result = await cancelRun(id);
  if (result === "failed") {
    item.removeAttribute("data-cancelling");
    button.disabled = false;
    if (meta) meta.textContent = panel.dataset.wordCancelFailed ?? before;
    return;
  }
  stopped.set(id, Date.now());
  furthest.delete(id);
  await render();
}

export function mountGenerations(): void {
  const found = document.getElementById("generations");
  if (!found) return;
  panel = found;
  if (mounted) {
    void render();
    return;
  }
  mounted = true;

  // The panel is a popover whose node persists across navigations; its listeners are on the node.
  panel.addEventListener("beforetoggle", (event) => {
    if ((event as ToggleEvent).newState !== "open") return;
    place();
    if (!panel?.hasAttribute("data-pull")) {
      panel?.setAttribute("data-pull", "");
      pullToDismiss(panel as HTMLElement, () => (panel as HTMLElement).hidePopover());
    }
  });
  panel.addEventListener("toggle", (event) => {
    if ((event as ToggleEvent).newState === "open") startPolling();
    else stopPolling();
  });
  panel.addEventListener("click", (event) => {
    const target = event.target as Element;
    const cancel = target.closest<HTMLButtonElement>("[data-gen-cancel]");
    if (cancel) void stop(cancel);
    if (target.closest("[data-menu-close], [data-create-open]")) panel?.hidePopover();
    if (target.closest("[data-gen-listen]")) {
      panel?.hidePopover();
      void import("./runStatus").then((module) => module.listenLive());
    }
  });

  // The run on record changed: the ring follows it, and an open list asks again.
  document.addEventListener(RUN_EVENT, () => {
    void (panel?.matches(":popover-open") ? refresh() : syncRing());
  });
  // A run was started here. On a wide screen the list opens to show it, once the sheet that started
  // it has gone, as a browser shows a download it has begun.
  document.addEventListener(GENERATION_STARTED_EVENT, () => {
    if (!matchMedia(WIDE).matches) return;
    window.setTimeout(() => {
      if (panel?.isConnected && !panel.matches(":popover-open")) panel.showPopover?.();
    }, OPEN_AFTER_START_MS);
  });

  if (panel.matches(":popover-open")) startPolling();
  else void syncRing();
}

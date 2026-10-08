/**
 * The run indicator: one line of status over a thin progress bar, in the side column from 64rem and
 * above the player bar below it. It lives in the layout and persists across client-side navigations;
 * the run id is kept in sessionStorage, so a reload picks the run up again. The status route names
 * the stage (n of m, lib/runStages.ts); the bar sits at the start of that stage and creeps toward,
 * never to, the next one on a slow CSS transition, so it never stands still and never goes back.
 * After the workflow has published, the last stage waits for the new page. Every sentence is in the element (`data-<state>`, or `data-<kind>-<state>` for a rewrite or a removal), and this
 * file imports nothing.
 */
const KEY = "dispatch:run";
const POLL_MS = 4000;
const MAX_POLLS = 300;

type Phase = "queued" | "running" | "updating" | "done" | "started" | "failed";
/** What the run does to an episode that exists. Absent means a new episode. */
type Kind = "regenerate" | "delete";
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
}

/** The stage fields of a status answer, kept with the run. */
const staged = (body: { stage?: number; stages?: number; label?: string }) => ({
  stage: body.stage,
  stages: body.stages,
  label: body.label,
});

const FINISHED: Phase[] = ["done", "started", "failed"];
let following = 0;

function read(): Stored | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return value && typeof value.id === "number" ? value : null;
  } catch {
    return null;
  }
}

function write(run: Stored | null): void {
  try {
    if (run) sessionStorage.setItem(KEY, JSON.stringify(run));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked; the indicator then lasts until the page does.
  }
}

function dismiss(): void {
  following = 0;
  write(null);
  show(null);
  // The button that was pressed is gone with the card: hand focus to the Create button in view.
  for (const create of document.querySelectorAll<HTMLElement>("[data-create-open]")) {
    if (create.getClientRects().length) {
      create.focus();
      return;
    }
  }
}

function show(run: Stored | null): void {
  const root = document.querySelector<HTMLElement>("[data-run-status]");
  const card = root?.querySelector<HTMLElement>("[data-run-card]");
  if (!root || !card) return;
  if (!root.hasAttribute("data-bound")) {
    root.setAttribute("data-bound", "");
    root.addEventListener("click", (event) => {
      if ((event.target as Element).closest("[data-run-dismiss]")) dismiss();
    });
  }
  const finished = run ? FINISHED.includes(run.phase) : false;
  card.hidden = !run;
  if (run) {
    card.dataset.state = run.phase;
    const text = card.querySelector("[data-run-text]");
    // A rewrite in the "running" phase reads data-regenerate-running; a new episode reads data-running.
    const key = run.kind ? run.kind + run.phase.charAt(0).toUpperCase() + run.phase.slice(1) : "";
    // A new episode says its stage. Only a change is written, so a screen reader hears each stage once.
    const named = !run.kind && run.label && run.phase !== "queued";
    const line =
      named && run.phase === "failed"
        ? (root.dataset.failedStage ?? "").replace("{label}", run.label?.toLowerCase() ?? "")
        : named && run.phase !== "done" && run.phase !== "started"
          ? run.label
          : (root.dataset[key] ?? root.dataset[run.phase]);
    if (text && text.textContent !== (line ?? "")) text.textContent = line ?? "";
    fill(card, run);
  }
  const library = card.querySelector<HTMLElement>("[data-run-library]");
  if (library) {
    library.hidden = (run?.phase !== "done" && run?.phase !== "started") || run?.kind === "delete";
  }
  const close = card.querySelector<HTMLElement>("[data-run-dismiss]");
  if (close) close.hidden = !finished;
  // The page reserves room for the indicator while it is up, the way it does for the player bar.
  if (run) document.documentElement.dataset.run = run.phase;
  else delete document.documentElement.dataset.run;
  // The episode page listens, so it can disable its actions while its own episode is being changed.
  document.dispatchEvent(new Event("dispatch:run"));
}

/** The bar: at the start of the stage at once, then slowly toward its end, and never back. */
let creep = 0;
function fill(card: HTMLElement, run: Stored): void {
  // A rewrite or a removal has no last stage of its own: the page has nothing to wait for.
  const total = (run.stages ?? 3) - (run.kind ? 1 : 0);
  const stage = Math.min(run.stage ?? 0, total - 1);
  const key = `${run.id}:${run.phase}:${stage}`;
  if (card.dataset.fill === key) return;
  card.dataset.fill = key;
  clearTimeout(creep);
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
}

/** The last stage: ask until the redeployed site lists the new episode, then offer it. */
async function waitForSite(run: Stored): Promise<void> {
  if (following === run.id) return;
  following = run.id;
  for (let turn = 0; turn < 60 && following === run.id; turn += 1) {
    const res = await fetch(`/latest.json?t=${Date.now()}`, { cache: "no-store" }).catch(
      () => null,
    );
    const body = res?.ok ? await res.json().catch(() => null) : null;
    if (following !== run.id) return;
    if (body?.episode_at && Date.parse(body.episode_at) >= (run.t0 ?? 0) - 60_000) {
      following = 0;
      const link = document.querySelector<HTMLAnchorElement>("[data-run-library]");
      if (link && body.episode_id) {
        link.href = `/e/${body.episode_id}`;
        link.textContent =
          document.querySelector<HTMLElement>("[data-run-status]")?.dataset.open ?? "";
      }
      set({ ...run, phase: "done" });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (following === run.id) {
    following = 0;
    set({ ...run, phase: "started" });
  }
}

async function follow(run: Stored, now: boolean): Promise<void> {
  if (following === run.id) return;
  following = run.id;
  let phase = run.phase;
  let stage = run.stage;
  for (let turn = 0; turn < MAX_POLLS && following === run.id; turn += 1) {
    if (turn > 0 || !now) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (following !== run.id) return;
    const res = await fetch(`/api/status?run=${run.id}`).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    // A run the status route does not know (a 4xx): the episode was started all the same, so say
    // that and stop asking. A hiccup is asked again, until the loop runs out.
    if (res && res.status < 500 && !res.ok) break;
    if (!body?.state) continue;
    if (body.state === "completed") {
      following = 0;
      const failed = body.outcome === "failed";
      // Published: a new episode still has to reach the site. An answer without stages is an older
      // route's, and finishes at once.
      const waiting = !failed && !run.kind && body.stages;
      const phase: Phase = failed ? "failed" : waiting ? "updating" : "done";
      const next = { ...run, ...staged(body), phase };
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
    if (next !== phase || body.stage !== stage) {
      phase = next;
      stage = body.stage;
      set({ ...run, ...staged(body), phase });
    }
  }
  if (following === run.id) {
    following = 0;
    set({ ...run, phase: "started" });
  }
}

/** Starts showing and following a run that has just been accepted. */
export function startRun(id: number, about?: { kind: Kind; episode: string }): void {
  const run: Stored = { id, phase: "queued", t0: Date.now(), ...about };
  following = 0;
  set(run);
  void follow(run, false);
}

/** After a reload or a navigation: shows the stored run again and, if it is still going, follows it. */
export function resumeRun(): void {
  const run = read();
  show(run);
  if (run?.phase === "updating") void waitForSite(run);
  else if (run && !FINISHED.includes(run.phase)) void follow(run, true);
}

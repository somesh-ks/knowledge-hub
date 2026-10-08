/**
 * The run indicator: one line of status over a thin progress bar, in the side column from 64rem and
 * above the player bar below it. It lives in the layout and persists across client-side navigations;
 * the run id is kept in sessionStorage, so a reload picks the run up again. The bar is indeterminate
 * while the run is going, because the status route reports a state, not a share. Every sentence is
 * in the element (`data-<state>`, or `data-<kind>-<state>` for a rewrite or a removal), and this
 * file imports nothing.
 */
const KEY = "dispatch:run";
const POLL_MS = 4000;
const MAX_POLLS = 300;

type Phase = "queued" | "running" | "done" | "started" | "failed";
/** What the run does to an episode that exists. Absent means a new episode. */
type Kind = "regenerate" | "delete";
interface Stored {
  id: number;
  phase: Phase;
  kind?: Kind;
  /** The episode a rewrite or a removal is about; its page disables its actions while the run goes. */
  episode?: string;
}

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
    if (create.getClientRects().length) return create.focus();
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
    if (text) text.textContent = root.dataset[key] ?? root.dataset[run.phase] ?? "";
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

function set(run: Stored): void {
  write(run);
  show(run);
}

async function follow(run: Stored, now: boolean): Promise<void> {
  if (following === run.id) return;
  following = run.id;
  let phase = run.phase;
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
      set({ ...run, phase: failed ? "failed" : "done" });
      // The removed episode's page has nothing left to show: go to the Library, where the line stays.
      if (!failed && run.kind === "delete" && location.pathname.startsWith("/e/")) {
        location.assign("/library");
      }
      return;
    }
    const next = body.state === "queued" ? "queued" : "running";
    if (next !== phase) {
      phase = next;
      set({ ...run, phase });
    }
  }
  if (following === run.id) {
    following = 0;
    set({ ...run, phase: "started" });
  }
}

/** Starts showing and following a run that has just been accepted. */
export function startRun(id: number, about?: { kind: Kind; episode: string }): void {
  const run: Stored = { id, phase: "queued", ...about };
  following = 0;
  set(run);
  void follow(run, false);
}

/** After a reload or a navigation: shows the stored run again and, if it is still going, follows it. */
export function resumeRun(): void {
  const run = read();
  show(run);
  if (run && !FINISHED.includes(run.phase)) void follow(run, true);
}

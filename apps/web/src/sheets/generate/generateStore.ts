/**
 * The Generate flow as an external store: submit the passphrase, poll the run, map its outcome.
 * It lives at module scope so a run keeps going when the sheet closes. Polling cadence follows the
 * sheet: every 3 seconds with backoff while it is open, a slow 15-second check while it is closed
 * so the toast can still say "Briefing ready", and none at all once the run has finished.
 */

import type { StorageLike } from "../../player/core/resume";
import type { GenerateCueKind } from "../../player/sound/soundMap";
import type { GenerateStep } from "../../types/contracts";
import { type ClientDeps, fetchStatus, startGenerate } from "./generateClient";
import { failureTitle, stepAnnouncement } from "./generateSteps";

export type GeneratePhase =
  | "idle"
  | "starting"
  | "running"
  | "published"
  | "nothing"
  | "gated"
  | "failed";

export type TerminalPhase = Extract<GeneratePhase, "published" | "nothing" | "gated" | "failed">;

export interface GenerateState {
  phase: GeneratePhase;
  runId: number | null;
  /** The step the server last reported; null while the run is queued. */
  step: GenerateStep | null;
  /** The step that was active when the run failed. */
  failedAt: GenerateStep | null;
  digestId: string | null;
  runUrl: string | null;
  /** The inline error under the passphrase field. */
  fieldError: string | null;
  /** The status endpoint stopped answering. The run may still be going. */
  lostContact: boolean;
}

export interface FinishedRun {
  phase: TerminalPhase;
  digestId: string | null;
  runUrl: string | null;
}

export interface GenerateStoreOptions extends ClientDeps {
  /** sessionStorage: the active run id survives a reload of the tab, not a new one. */
  storage: StorageLike | null;
  now?: () => number;
  isHidden?: () => boolean;
  onCue?: (kind: GenerateCueKind) => void;
  onAnnounce?: (message: string) => void;
  /** The run finished while the sheet was closed. */
  onFinishedWhileClosed?: (run: FinishedRun) => void;
}

export const RUN_STORAGE_KEY = "dispatch:generate:run";
export const FOREGROUND_POLL_MS = 3_000;
export const BACKGROUND_POLL_MS = 15_000;
export const MAX_POLL_MS = 30_000;
export const POLL_BACKOFF = 1.5;
export const MAX_CONSECUTIVE_FAILURES = 8;
/** A remembered run older than this is dead weight: the workflow's own timeout is well inside it. */
export const RUN_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const INITIAL: GenerateState = {
  phase: "idle",
  runId: null,
  step: null,
  failedAt: null,
  digestId: null,
  runUrl: null,
  fieldError: null,
  lostContact: false,
};

function isTerminal(phase: GeneratePhase): phase is TerminalPhase {
  return phase === "published" || phase === "nothing" || phase === "gated" || phase === "failed";
}

function isActive(phase: GeneratePhase): boolean {
  return phase === "running";
}

export interface GenerateStore {
  getState(): GenerateState;
  subscribe(listener: () => void): () => void;
  submit(passphrase: string): Promise<void>;
  /** Clears a finished run or an inline error so the form comes back. */
  reset(): void;
  /** Tells the store whether the sheet is showing, which sets the polling cadence. */
  setSheetOpen(open: boolean): void;
  /** Picks up a run remembered in session storage and checks it now. */
  resume(): void;
  /** Checks the active run immediately, e.g. from "Check again". */
  checkNow(): void;
  dispose(): void;
}

export function createGenerateStore(options: GenerateStoreOptions): GenerateStore {
  const {
    storage,
    now = () => Date.now(),
    isHidden = () => typeof document !== "undefined" && document.hidden,
    onCue,
    onAnnounce,
    onFinishedWhileClosed,
  } = options;
  const clientDeps: ClientDeps = { fetch: options.fetch, isOnline: options.isOnline };

  let state: GenerateState = INITIAL;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let sheetOpen = false;
  /** The finished run has been on screen, so closing the sheet clears it. */
  let resultDisplayed = false;
  let disposed = false;

  function setState(patch: Partial<GenerateState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function remember(runId: number, startedAt: number): void {
    try {
      storage?.setItem(RUN_STORAGE_KEY, JSON.stringify({ runId, startedAt }));
    } catch {
      // Best effort: the run still works, it just will not survive a reload.
    }
  }

  function forget(): void {
    try {
      storage?.removeItem(RUN_STORAGE_KEY);
    } catch {
      // Best effort.
    }
  }

  function recall(): { runId: number; startedAt: number } | null {
    try {
      const raw = storage?.getItem(RUN_STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return null;
      const { runId, startedAt } = parsed as { runId?: unknown; startedAt?: unknown };
      if (typeof runId !== "number" || typeof startedAt !== "number") return null;
      if (now() - startedAt > RUN_MAX_AGE_MS) {
        forget();
        return null;
      }
      return { runId, startedAt };
    } catch {
      return null;
    }
  }

  function stopTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function delayMs(): number {
    const base = sheetOpen && !isHidden() ? FOREGROUND_POLL_MS : BACKGROUND_POLL_MS;
    return Math.min(MAX_POLL_MS, base * POLL_BACKOFF ** failures);
  }

  function schedule(): void {
    stopTimer();
    if (disposed || !isActive(state.phase) || state.runId === null || state.lostContact) return;
    timer = setTimeout(() => void poll(), delayMs());
  }

  function finish(phase: TerminalPhase, digestId: string | null, runUrl: string | null): void {
    stopTimer();
    forget();
    const failedAt = phase === "failed" ? state.step : null;
    setState({ phase, digestId, runUrl, failedAt, lostContact: false });
    if (sheetOpen) resultDisplayed = true;
    if (phase === "published") onCue?.("finished");
    if (phase === "failed") onCue?.("failed");
    const message =
      phase === "published"
        ? "Briefing ready."
        : phase === "nothing"
          ? "Nothing cleared the bar."
          : phase === "gated"
            ? "The schedule held this run back."
            : `${failureTitle(failedAt)}.`;
    onAnnounce?.(message);
    if (!sheetOpen) onFinishedWhileClosed?.({ phase, digestId, runUrl });
  }

  async function poll(): Promise<void> {
    timer = null;
    const runId = state.runId;
    if (runId === null || !isActive(state.phase)) return;
    const result = await fetchStatus(runId, clientDeps);
    // The run may have been reset, or the store disposed, while the request was in flight.
    if (disposed || state.runId !== runId || !isActive(state.phase)) return;

    if (result.kind === "unknown") {
      forget();
      setState({ ...INITIAL });
      return;
    }
    if (result.kind === "transient") {
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        setState({ lostContact: true });
        return;
      }
      schedule();
      return;
    }

    failures = 0;
    const { status } = result;
    if (status.step && status.step !== state.step) {
      setState({ step: status.step });
      onAnnounce?.(stepAnnouncement(status.step, false));
    }
    if (status.state === "completed") {
      finish(status.outcome ?? "failed", status.digest_id ?? null, status.run_url ?? null);
      return;
    }
    schedule();
  }

  function startRun(runId: number, startedAt: number): void {
    remember(runId, startedAt);
    failures = 0;
    setState({
      phase: "running",
      runId,
      step: null,
      failedAt: null,
      digestId: null,
      runUrl: null,
      fieldError: null,
      lostContact: false,
    });
  }

  function reset(): void {
    stopTimer();
    forget();
    failures = 0;
    resultDisplayed = false;
    setState({ ...INITIAL });
  }

  function resume(): void {
    if (disposed || state.phase !== "idle") return;
    const remembered = recall();
    if (!remembered) return;
    // Keep the original start time, so a run that is long gone still ages out.
    startRun(remembered.runId, remembered.startedAt);
    void poll();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async submit(passphrase) {
      if (state.phase === "starting" || isActive(state.phase)) return;
      setState({ phase: "starting", fieldError: null });
      const result = await startGenerate(passphrase, clientDeps);
      if (disposed) return;
      if (result.kind === "rejected") {
        setState({ phase: "idle", fieldError: result.message });
        onCue?.("failed");
        return;
      }
      startRun(result.runId, now());
      onCue?.("started");
      onAnnounce?.(stepAnnouncement("waiting", true));
      schedule();
    },
    reset,
    setSheetOpen(open) {
      if (open === sheetOpen) return;
      sheetOpen = open;
      if (open) {
        if (isTerminal(state.phase)) resultDisplayed = true;
        if (state.phase === "idle") resume();
        else if (isActive(state.phase)) {
          failures = 0;
          setState({ lostContact: false });
          void poll();
        }
        return;
      }
      if (isTerminal(state.phase) && resultDisplayed) reset();
      else if (isActive(state.phase)) schedule();
    },
    resume,
    checkNow() {
      if (!isActive(state.phase)) return;
      failures = 0;
      setState({ lostContact: false });
      void poll();
    },
    dispose() {
      disposed = true;
      stopTimer();
      listeners.clear();
    },
  };
}

/**
 * Whether this device can reach the site: one answer for the whole app (D330). The browser's own
 * flag is a hint, not a fact (a phone on Wi-Fi with no data says online; the event for coming back
 * can fire before the network is usable, or not at all after the app was asleep). So the state is
 * what the browser says, confirmed by asking the site itself, and an unconfirmed return is asked
 * again on its own, with growing gaps, until it answers.
 *
 * Everything that depends on the connection reads `isOnline()` or subscribes here: the strip, the
 * disabled controls, the outbox, the stand-in page's recovery. Nothing else keeps its own copy, so
 * two parts of the app never disagree about the connection. Pure: the browser's hooks come in as
 * `deps`, and `connectivity` below is the one instance the page uses.
 */

export type Link = "online" | "offline";

export interface ConnectivityDeps {
  /** The browser's flag (navigator.onLine). */
  hint(): boolean;
  /** Asks the site. True for any answer, a refusal included; false only when nothing came back. */
  reach(): Promise<boolean>;
  /** Runs `run` after `ms`; returns what cancels it. */
  later(run: () => void, ms: number): () => void;
}

/** The gaps between asks while a return is unconfirmed: it eases off to the last one and stays there. */
export const RETRY_GAPS_MS = [2000, 4000, 8000, 15000] as const;

export type Listener = (link: Link, previous: Link) => void;

export interface Connectivity {
  link(): Link;
  /** Calls `listener` when the link changes. Returns what stops it. */
  subscribe(listener: Listener): () => void;
  /** The browser fired `offline`: it is true at once, nothing to confirm. */
  hintOffline(): void;
  /** The browser fired `online`, or the app came back to the front: confirm it by asking the site. */
  hintOnline(): void;
  /** A request to the site failed with no answer while the browser claims it is online. */
  reportUnreachable(): void;
  /** Asks the site now (Try again). Resolves to the link it found. */
  check(): Promise<Link>;
  /** Stops asking on its own. */
  dispose(): void;
}

export function createConnectivity(deps: ConnectivityDeps): Connectivity {
  let current: Link = deps.hint() ? "online" : "offline";
  const listeners = new Set<Listener>();
  let asking: Promise<Link> | undefined;
  let cancelRetry: (() => void) | undefined;
  let attempt = 0;

  const set = (next: Link): void => {
    if (next === current) return;
    const previous = current;
    current = next;
    for (const listener of [...listeners]) listener(next, previous);
  };

  const stopRetry = (): void => {
    cancelRetry?.();
    cancelRetry = undefined;
  };

  const ask = (): Promise<Link> => {
    asking ??= deps
      .reach()
      .catch(() => false)
      .then((reached) => {
        asking = undefined;
        if (reached) {
          attempt = 0;
          stopRetry();
          set("online");
          return "online" as const;
        }
        set("offline");
        // While the browser claims it is online the claim is checked again; when it says offline
        // the next hint is the event that ends it.
        if (deps.hint()) scheduleRetry();
        return "offline" as const;
      });
    return asking;
  };

  function scheduleRetry(): void {
    stopRetry();
    const gap = RETRY_GAPS_MS[Math.min(attempt, RETRY_GAPS_MS.length - 1)] as number;
    attempt += 1;
    cancelRetry = deps.later(() => {
      cancelRetry = undefined;
      void ask();
    }, gap);
  }

  return {
    link: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hintOffline() {
      stopRetry();
      attempt = 0;
      set("offline");
    },
    hintOnline() {
      // Already online, nothing is unconfirmed: asking would only cost a request.
      if (current === "offline") void ask();
    },
    reportUnreachable() {
      if (current === "offline" || !deps.hint()) return;
      set("offline");
      scheduleRetry();
    },
    check: ask,
    dispose: stopRetry,
  };
}

/** The browser's own flag alone: false only when it knows there is no network at all (airplane mode). */
export const browserOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine !== false;

/** The page's own instance, made on first use so importing this file in a test or on the server does nothing. */
let instance: Connectivity | undefined;

export function connectivity(): Connectivity {
  instance ??= createConnectivity({
    hint: browserOnline,
    reach: () =>
      // Any answer proves the site is reachable; a 4xx or 5xx is still an answer. A tiny static file, so a
      // probe costs no function run, and never from a cache.
      fetch("/build.json", { cache: "no-store", signal: AbortSignal.timeout(8000) }).then(
        () => true,
        () => false,
      ),
    later: (run, ms) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    },
  });
  return instance;
}

/** For a test: the next use starts from the browser's flag again, with nothing scheduled. */
export function resetConnectivity(): void {
  instance?.dispose();
  instance = undefined;
}

/** Whether the site can be reached now. */
export const isOnline = (): boolean => connectivity().link() === "online";

/**
 * True while the app moves itself to another page (the stand-in's recovery), as opposed to the
 * reader's own move. A page load during it is not the reader's act, so it never lets a held
 * update reload (scripts/serviceWorker.ts).
 */
export const automaticMove = { active: false };

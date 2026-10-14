import { setRootAttribute } from "./rootAttributes";
import type { SurfaceController, SurfaceSnapshot } from "./sheetController";

/**
 * The one player surface: the bar that grows into the page. Its motion (playerSheetMotion.ts: the
 * state machine, the spring, the gestures, the modal scope) is not in the first load. It loads at
 * idle with the open page's controls, or at the first press on the bar if that comes sooner; a call
 * made before then waits for it, and calls run in the order they were made. Until it loads the
 * surface is at rest, closed, as the island's markup draws it. Creating this touches nothing, so it
 * is safe during SSR.
 */
const AT_REST: SurfaceSnapshot = { state: "collapsed", open: false, landed: false };

let motion: SurfaceController | null = null;
let loading: Promise<SurfaceController> | null = null;
/** Where the chunk lives, learned from the first failure. */
let failedUrl: string | null = null;
const listeners = new Set<() => void>();

/**
 * Chromium remembers a module whose fetch failed and fails every later import of it at once, so a
 * retry asks for the same file under a new query string, as the open page's controls do
 * (pageContentLoader.ts).
 */
function importMotion(): Promise<typeof import("./playerSheetMotion")> {
  if (!failedUrl) return import("./playerSheetMotion");
  const separator = failedUrl.includes("?") ? "&" : "?";
  return import(/* @vite-ignore */ `${failedUrl}${separator}retry=${Date.now()}`);
}

/** Loads the motion once. A failure is forgotten, so the next press tries again. */
export function loadPlayerSheet(): Promise<SurfaceController> {
  loading ??= importMotion().then(
    (module) => {
      const created = module.createPlayerSheet();
      created.subscribe(() => {
        for (const listener of listeners) listener();
      });
      created.sync();
      motion = created;
      return created;
    },
    (error: unknown) => {
      loading = null;
      failedUrl ??= /https?:\/\/\S+/.exec(error instanceof Error ? error.message : "")?.[0] ?? null;
      throw error;
    },
  );
  return loading;
}

/** Runs `call` on the motion now, or once it has loaded. */
function whenLoaded(call: (loaded: SurfaceController) => void): void {
  if (motion) call(motion);
  else void loadPlayerSheet().then(call, () => undefined);
}

export const playerSheet: SurfaceController = {
  expand: () => whenLoaded((loaded) => loaded.expand()),
  // At rest it is already closed; a close asked for while it loads waits for what came before it.
  collapse: () =>
    motion
      ? motion.collapse()
      : loading
        ? loading.then(
            (loaded) => loaded.collapse(),
            () => undefined,
          )
        : Promise.resolve(),
  collapseNow: () => {
    if (motion || loading) whenLoaded((loaded) => loaded.collapseNow());
  },
  toggle: () => whenLoaded((loaded) => loaded.toggle()),
  pointerDown: (input) => whenLoaded((loaded) => loaded.pointerDown(input)),
  // A move or a lift with nothing loaded or loading belongs to no gesture (a mouse passing over).
  pointerMove: (input) => {
    if (motion || loading) whenLoaded((loaded) => loaded.pointerMove(input));
  },
  pointerEnd: (input, cancelled) => {
    if (motion || loading) whenLoaded((loaded) => loaded.pointerEnd(input, cancelled));
  },
  click: (event) => whenLoaded((loaded) => loaded.click(event)),
  sync: () => {
    if (motion) motion.sync();
    // The markup is at rest already; only the root, which a new document brings, needs saying.
    else setRootAttribute("data-player", "closed");
  },
  getSnapshot: () => motion?.getSnapshot() ?? AT_REST,
  getProgress: () => motion?.getProgress() ?? 0,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

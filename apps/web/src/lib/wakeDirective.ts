import type { ClientDirective } from "astro";

/**
 * `client:wake`: an island that hydrates when the page asks for it (scripts/islandWake.ts), not at
 * load, so React and the islands stay off a first visit until a track starts, a sheet or a toast is
 * asked for, or the browser is idle after the first input (docs/engineering/first-load-js.md, cut 1).
 * The wake also fetches the island's whole graph at once, so it arrives in one round trip.
 */
const WAKE_EVENT = "dispatch:wake";

interface WakeScope {
  dispatchAwake?: boolean;
}

const wakeDirective: ClientDirective = (load, _options, element) => {
  const start = async (): Promise<void> => {
    await (await load())();
  };
  // Awake already: a persisted island that a navigation moved, or one the page woke before it.
  if ((window as WakeScope).dispatchAwake) {
    void start();
    return;
  }
  // A move before the wake connects the island again; one listener is enough.
  if (element.dataset.wakeWaiting) return;
  element.dataset.wakeWaiting = "";
  addEventListener(
    WAKE_EVENT,
    () => {
      delete element.dataset.wakeWaiting;
      void start();
    },
    { once: true },
  );
};

export default wakeDirective;

declare module "astro" {
  interface AstroClientDirectives {
    "client:wake"?: boolean;
  }
}

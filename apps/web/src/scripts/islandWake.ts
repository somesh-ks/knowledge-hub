import { isBriefingGoing, readRunRecord } from "../lib/runRecord";
import { isSheetName, type SheetName } from "../sheets/sheetEvents";
import { whenIdle } from "./idle";
import { TOAST_EVENT } from "./toastEvent";

/**
 * Wakes the player and sheets islands (`client:wake`, lib/wakeDirective.ts). They are React, about
 * 75 KB of a first visit, and nothing on screen needs them until a track starts (the bar), a sheet
 * or a toast is asked for. They wake on the first of those, and otherwise once the browser is idle
 * after the first input, so the bar and the sheets are ready before most presses reach them.
 */

const WAKE_EVENT = "singularity:wake";

interface WakeScope {
  dispatchAwake?: boolean;
}

export function wakeIslands(): void {
  const scope = window as WakeScope;
  if (scope.dispatchAwake) return;
  scope.dispatchAwake = true;
  // The islands' own imports are one level at a time; these fetch each island's whole graph at
  // once (Vite preloads a dynamic import's dependencies), and the directive's imports then find it.
  void import("@astrojs/react/client.js").catch(() => undefined);
  void import("../player/PlayerRoot").catch(() => undefined);
  void import("../sheets/SheetsRoot").catch(() => undefined);
  dispatchEvent(new Event(WAKE_EVENT));
}

let earlySheet: SheetName | null = null;
let sheetsListening = false;

/**
 * The sheet a press asked for before the sheets island listened, once; the island calls it when its
 * own listener is in place, and every later press reaches that listener instead.
 */
export function takeEarlySheet(): SheetName | null {
  sheetsListening = true;
  const name = earlySheet;
  earlySheet = null;
  return name;
}

let installed = false;

/**
 * Install wake listeners once, retaining an early sheet press until the island can handle it.
 * A remembered briefing in progress wakes the islands immediately; otherwise a sheet, toast or
 * idle time after the first input wakes them.
 */
export function installIslandWake(): void {
  if (installed) return;
  installed = true;
  // A press on a sheet's control before the island listens is kept, so the sheet still opens.
  document.addEventListener(
    "click",
    (event) => {
      if (sheetsListening || !(event.target instanceof Element)) return;
      const trigger = event.target.closest<HTMLElement>("[data-open-sheet], [data-open]");
      const name = trigger?.dataset.openSheet ?? trigger?.dataset.open;
      if (!isSheetName(name)) return;
      event.preventDefault();
      earlySheet = name;
      wakeIslands();
    },
    true,
  );
  // A toast sent before the sheets loaded waits for their store (toastEvent.ts), which this brings.
  document.addEventListener(TOAST_EVENT, wakeIslands);
  // A briefing run remembered from before a reload ends with a sound the sheets island plays, so the
  // sheets come now.
  if (isBriefingGoing(readRunRecord(() => localStorage))) {
    wakeIslands();
    return;
  }
  const options = { capture: true, passive: true, once: true } as const;
  const onFirstInput = (): void => {
    for (const type of ["pointerdown", "keydown", "wheel"]) {
      removeEventListener(type, onFirstInput, options);
    }
    whenIdle(wakeIslands, 2_000);
  };
  for (const type of ["pointerdown", "keydown", "wheel"]) {
    addEventListener(type, onFirstInput, options);
  }
}

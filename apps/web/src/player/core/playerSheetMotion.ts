import { getHaptics, playUiCue } from "../sound/soundController";
import { cueForSheet } from "../sound/soundMap";
import { INERT_MARKER } from "./modalScope";
import { setRootAttribute } from "./rootAttributes";
import { takeQuietOpen } from "./sessionRestore";
import { type CommitVia, createSurfaceController, type SurfaceController } from "./sheetController";
import { createSurfaceView } from "./surfaceView";

function readToken(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  // Durations arrive as "200ms" or "0.2s"; everything else is a bare number.
  return raw.endsWith("s") && !raw.endsWith("ms") ? value * 1000 : value;
}

function heard(opening: boolean, via: CommitVia): void {
  const cue = cueForSheet(opening);
  if (via === "drag" && cue.haptic) getHaptics().fire(cue.haptic);
  else playUiCue(cue);
}

/**
 * The player surface's motion: the state machine, the spring, the gestures and the modal scope,
 * which playerSheet.ts loads after first paint. Its numbers come from tokens, read when a motion
 * needs them.
 */
export function createPlayerSheet(): SurfaceController {
  const playerSheet = createSurfaceController({
    view: createSurfaceView(),
    reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    thresholds: () => ({
      distance: readToken("--player-dismiss-distance", 0.35),
      velocity: readToken("--player-dismiss-velocity", 0.5),
    }),
    fadeMs: () => readToken("--duration-state", 200),
    releaseBounce: () => readToken("--spring-release-bounce", 0),
    setRootAttribute,
    // A cue at the moment of commit: the pull that springs back is not a commit and stays silent.
    // A swipe that commits is felt and not heard (owner, 2026-11-03); a tap, a key or a command is both.
    onCommitOpen: (via) => {
      if (!takeQuietOpen()) heard(true, via);
    },
    onCommitClose: (via) => heard(false, via),
  });

  if (import.meta.env.DEV) {
    // The failure this guards against is the new "stuck": a closed player that left the page inert.
    playerSheet.subscribe(() => {
      if (playerSheet.getSnapshot().open) return;
      const left = document.querySelectorAll(`[${INERT_MARKER}]`).length;
      if (left > 0) console.error(`[player] ${left} element(s) left inert after the player closed`);
    });
  }
  return playerSheet;
}

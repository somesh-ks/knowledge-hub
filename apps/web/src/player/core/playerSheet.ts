import { playUiCue } from "../sound/soundController";
import { cueForSheet } from "../sound/soundMap";
import { INERT_MARKER } from "./modalScope";
import { setRootAttribute } from "./rootAttributes";
import { createSurfaceController } from "./sheetController";
import { createSurfaceView } from "./surfaceView";

function readToken(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  // Durations arrive as "200ms" or "0.2s"; everything else is a bare number.
  return raw.endsWith("s") && !raw.endsWith("ms") ? value * 1000 : value;
}

/**
 * The one player surface: the bar that grows into the page. Creating it touches nothing, so it is
 * safe during SSR. Its numbers come from tokens, read when a motion needs them.
 */
export const playerSheet = createSurfaceController({
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
  onCommitOpen: () => playUiCue(cueForSheet(true)),
  onCommitClose: () => playUiCue(cueForSheet(false)),
});

if (import.meta.env.DEV) {
  // The failure this guards against is the new "stuck": a closed player that left the page inert.
  playerSheet.subscribe(() => {
    if (playerSheet.getSnapshot().open) return;
    const left = document.querySelectorAll(`[${INERT_MARKER}]`).length;
    if (left > 0) console.error(`[player] ${left} element(s) left inert after the player closed`);
  });
}

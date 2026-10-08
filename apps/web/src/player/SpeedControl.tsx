import { getPlayerStore } from "./core/playerRuntime";
import { PLAYBACK_RATES } from "./core/playerTypes";
import { usePlayerState } from "./hooks/usePlayer";

/**
 * One quiet button that shows the speed and steps to the next one: 1x, 1.25x, 1.5x, 2x, and round
 * again, with pitch preserved. The choice is remembered and shared with Settings, where all four
 * are laid out to pick from.
 */
export default function SpeedControl() {
  const state = usePlayerState();
  const index = (PLAYBACK_RATES as readonly number[]).indexOf(state.rate);
  const next = PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1;
  return (
    <button
      className="speed-btn press num"
      type="button"
      aria-label={`Speed ${state.rate}x. Change to ${next}x`}
      onClick={() => getPlayerStore().setRate(next)}
    >
      {state.rate}x
    </button>
  );
}

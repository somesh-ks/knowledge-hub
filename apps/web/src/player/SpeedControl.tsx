import { useId } from "react";
import { getPlayerStore } from "./core/playerRuntime";
import { PLAYBACK_RATES } from "./core/playerTypes";
import { usePlayerState } from "./hooks/usePlayer";

/**
 * 1x, 1.25x, 1.5x, 2x with pitch preserved, as a row of round outlined chips. Native radios inside
 * labels: arrow keys, form state and the accessible group come free. The choice is remembered and
 * shared with Settings.
 */
export default function SpeedControl() {
  const state = usePlayerState();
  const name = useId();
  return (
    <fieldset className="speed">
      <legend className="speed-legend">Speed</legend>
      <div className="speed-chips">
        {PLAYBACK_RATES.map((rate) => (
          <label key={rate} className="speed-chip">
            <input
              type="radio"
              name={name}
              value={rate}
              checked={rate === state.rate}
              onChange={() => getPlayerStore().setRate(rate)}
            />
            <span>{rate}x</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

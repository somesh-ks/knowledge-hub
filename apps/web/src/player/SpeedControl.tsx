import { getPlayerStore } from "./core/playerRuntime";
import { PLAYBACK_RATES } from "./core/playerTypes";
import { usePlayerState } from "./hooks/usePlayer";
import SegmentedControl from "./ui/SegmentedControl";

const OPTIONS = PLAYBACK_RATES.map((rate) => ({ value: String(rate), label: `${rate}x` }));

/** 1x, 1.25x, 1.5x, 2x with pitch preserved. The choice is remembered and shared with Settings. */
export default function SpeedControl() {
  const state = usePlayerState();
  return (
    <SegmentedControl
      legend="Speed"
      options={OPTIONS}
      value={String(state.rate)}
      onChange={(value) => getPlayerStore().setRate(Number(value))}
    />
  );
}

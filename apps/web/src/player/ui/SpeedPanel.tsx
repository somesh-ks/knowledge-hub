import type { CSSProperties } from "react";
import { sliderClass, sliderWaveFieldClass } from "../../design-system/slider";
import "../../styles/slider.css";
import "../../styles/speed-panel.css";
import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE, PLAYBACK_RATE_STEP } from "../core/playerTypes";
import { rateFace, rateLabel } from "../rateLabels";
import Icon from "./LazyIcon";

/** The slider stops on every 0.25x, seven dots on its track. Between them the stepper goes by PLAYBACK_RATE_STEP. */
const STOP_STEP = 0.25;
const nearestStop = (rate: number): number =>
  Math.min(
    MAX_PLAYBACK_RATE,
    Math.max(MIN_PLAYBACK_RATE, Math.round(rate / STOP_STEP) * STOP_STEP),
  );

/**
 * The speed screen: a stepper around a big readout (exact, by PLAYBACK_RATE_STEP), a slider under
 * it that stops on every 0.25x (dots on the track, no labels; wavy in Expressive). It owns no speed: the caller
 * passes the current one and hears every change, so the player's ⋮ menu sets the playing speed and
 * Settings sets the default with the same control. Mount it in a sheet or a card; its rules are in
 * styles/speed-panel.css.
 */
export default function SpeedPanel({
  rate,
  onRate,
}: {
  rate: number;
  onRate: (next: number) => void;
}) {
  // The thumb stands on the stop nearest the speed; the readout and the stepper say the exact one.
  const stop = nearestStop(rate);
  const fill = (stop - MIN_PLAYBACK_RATE) / (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE);
  return (
    <div className="player-speed">
      <div className="player-speed-stepper">
        <button
          className="icon-btn icon-btn-tonal press"
          type="button"
          aria-label="Slower"
          disabled={rate <= MIN_PLAYBACK_RATE}
          onClick={() => onRate(rate - PLAYBACK_RATE_STEP)}
        >
          <Icon name="minus" />
        </button>
        <output
          className="player-speed-readout num"
          aria-hidden="true"
          data-off={Math.abs(rate - 1) > 0.001 ? "" : undefined}
        >
          {rateFace(rate)}
        </output>
        <button
          className="icon-btn icon-btn-tonal press"
          type="button"
          aria-label="Faster"
          disabled={rate >= MAX_PLAYBACK_RATE}
          onClick={() => onRate(rate + PLAYBACK_RATE_STEP)}
        >
          <Icon name="plus" />
        </button>
      </div>
      <div
        className={sliderWaveFieldClass()}
        style={{ "--range-fill": `${(fill * 100).toFixed(1)}%` } as CSSProperties}
      >
        <input
          className={sliderClass()}
          type="range"
          min={MIN_PLAYBACK_RATE}
          max={MAX_PLAYBACK_RATE}
          step={STOP_STEP}
          value={stop}
          aria-label="Playback speed"
          aria-valuetext={rateLabel(rate)}
          style={{ "--range-fill": `${(fill * 100).toFixed(1)}%` } as CSSProperties}
          onChange={(event) => onRate(event.currentTarget.valueAsNumber)}
        />
      </div>
    </div>
  );
}

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { getPlayerStore } from "./core/playerRuntime";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  PLAYBACK_RATE_STEP,
  toPlaybackRate,
} from "./core/playerTypes";
import { usePlayerState } from "./hooks/usePlayer";

/** The gap between the button and its panel. */
const PANEL_GAP_PX = 8;

/** "1x", "1.25x", "0.5x": no trailing zeros. */
export function rateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}x`;
}

/**
 * The speed: a button between the two skips that shows it, and a panel with a slider from half
 * speed to double (pitch preserved). The panel is a native popover, so it sits in the top layer
 * and closes on an outside press; Escape closes it without closing the player behind it. The
 * choice is remembered.
 */
export default function SpeedControl() {
  const state = usePlayerState();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // Placed against the button, centred on it: above it when there is room, else below it.
    const place = (): void => {
      const button = buttonRef.current?.getBoundingClientRect();
      if (!button) return;
      const above = button.top - PANEL_GAP_PX - panel.offsetHeight;
      const top = above >= PANEL_GAP_PX ? above : button.bottom + PANEL_GAP_PX;
      panel.style.setProperty("--panel-top", `${top}px`);
      panel.style.setProperty("--panel-center", `${button.left + button.width / 2}px`);
    };
    const settle = (event: Event): void => {
      const isOpen = (event as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (!isOpen) return;
      // Measured once it is laid out, so the side is chosen from its real height.
      place();
      panel.querySelector<HTMLElement>("input")?.focus();
    };
    const beforeOpen = (event: Event): void => {
      if ((event as ToggleEvent).newState === "open") place();
    };
    panel.addEventListener("beforetoggle", beforeOpen);
    panel.addEventListener("toggle", settle);
    return () => {
      panel.removeEventListener("beforetoggle", beforeOpen);
      panel.removeEventListener("toggle", settle);
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Escape" && event.key !== "Tab") return;
    // Escape belongs to the panel while it is open: the player behind it stays.
    event.preventDefault();
    panelRef.current?.hidePopover();
    buttonRef.current?.focus();
  }

  const fill = (state.rate - MIN_PLAYBACK_RATE) / (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE);

  return (
    <div className="speed">
      <button
        ref={buttonRef}
        className="speed-btn press num"
        type="button"
        popoverTarget={panelId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Playback speed ${rateLabel(state.rate)}`}
      >
        {rateLabel(state.rate)}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className="speed-panel"
        popover="auto"
        role="dialog"
        aria-label="Playback speed"
        onKeyDown={onKeyDown}
      >
        <output className="speed-value num" aria-hidden="true">
          {rateLabel(state.rate)}
        </output>
        <input
          className="speed-slider"
          type="range"
          min={MIN_PLAYBACK_RATE}
          max={MAX_PLAYBACK_RATE}
          step={PLAYBACK_RATE_STEP}
          value={state.rate}
          aria-label="Playback speed"
          aria-valuetext={rateLabel(state.rate)}
          style={{ "--range-fill": `${(fill * 100).toFixed(1)}%` } as React.CSSProperties}
          onChange={(event) =>
            getPlayerStore().setRate(toPlaybackRate(event.currentTarget.valueAsNumber))
          }
        />
        <div className="speed-scale num" aria-hidden="true">
          <span>{rateLabel(MIN_PLAYBACK_RATE)}</span>
          <span>{rateLabel(MAX_PLAYBACK_RATE)}</span>
        </div>
      </div>
    </div>
  );
}

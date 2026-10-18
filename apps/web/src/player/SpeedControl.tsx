import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  PLAYBACK_RATE_STEP,
  PLAYBACK_RATES,
  toPlaybackRate,
} from "./core/playerTypes";
import { usePlayerState } from "./hooks/usePlayer";

/** The gap between the button and its panel, and the least the panel keeps from the window's edge. */
const PANEL_GAP_PX = 8;

/** "1x", "1.25x", "0.5x": no trailing zeros. What is said, and the presets, which never change. */
export function rateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}x`;
}

/**
 * "1.00x", "1.05x", "0.50x": the button's label, always five characters. Tabular digits keep each
 * digit one width, but "1x" against "1.05x" changed the label's length, so as the speed moved the
 * centred label slid by up to 11px (the owner: "not having set character width", 2026-10-18).
 */
export function rateFace(rate: number): string {
  return `${rate.toFixed(2)}x`;
}

/**
 * Puts the panel against the button, centred on it. On a phone the transport is above the button,
 * so with a finger the panel goes below it; with a mouse it goes above. Either way it takes the
 * other side when its own has no room, and it never leaves the window.
 */
function place(panel: HTMLElement, button: HTMLElement | null): DOMRect | null {
  if (!button) return null;
  const anchor = button.getBoundingClientRect();
  const height = panel.offsetHeight;
  const above = anchor.top - PANEL_GAP_PX - height;
  const below = anchor.bottom + PANEL_GAP_PX;
  const fitsAbove = above >= PANEL_GAP_PX;
  const fitsBelow = below + height <= window.innerHeight - PANEL_GAP_PX;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const side = (touch ? fitsBelow || !fitsAbove : fitsBelow && !fitsAbove) ? "below" : "above";
  const top = Math.max(
    PANEL_GAP_PX,
    Math.min(side === "below" ? below : above, window.innerHeight - height - PANEL_GAP_PX),
  );
  panel.dataset.side = side;
  panel.style.setProperty("--panel-top", `${top}px`);
  panel.style.setProperty("--panel-center", `${anchor.left + anchor.width / 2}px`);
  return anchor;
}

/**
 * With a finger the panel opens below the button, clear of the transport above it. When the window
 * has no room there, the page scrolls up by the shortfall first (when it has that much to give)
 * rather than the panel flipping over the controls.
 */
function makeRoom(panel: HTMLElement, button: HTMLElement | null): void {
  if (!button || !window.matchMedia("(pointer: coarse)").matches) return;
  const page = button.closest<HTMLElement>("[data-player-page]");
  if (!page) return;
  const needed = button.getBoundingClientRect().bottom + PANEL_GAP_PX + panel.offsetHeight;
  const shortfall = needed - (window.innerHeight - PANEL_GAP_PX);
  // A pixel over, so the side check afterwards never fails on rounding.
  if (shortfall > 0) page.scrollBy({ top: Math.ceil(shortfall) + 1, behavior: "instant" });
}

/**
 * The speed: a button between the two skips that shows it, and a panel with a slider from half
 * speed to double (pitch preserved) and the common speeds under it. The panel is a modal dialog: a
 * press outside it lands on its backdrop, which closes it and reaches nothing underneath. Escape
 * closes it without closing the player behind it. The choice is remembered.
 */
export default function SpeedControl() {
  const state = usePlayerState();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  // Where the press began, so a drag that starts on the slider and ends outside does not close it.
  const pressedBackdrop = useRef(false);
  const [open, setOpen] = useState(false);

  // While open it follows the button when the window changes size, and goes away when a scroll
  // carries the button out from under it or the player closes behind it. The briefing behind the
  // player scrolls as the voice moves on; that moves nothing here, so it is let be.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    let anchor = buttonRef.current?.getBoundingClientRect() ?? null;
    const follow = (): void => {
      anchor = place(panel, buttonRef.current);
    };
    let frameId: number | null = null;
    const dismiss = (): void => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const now = buttonRef.current?.getBoundingClientRect();
        if (!anchor || !now) return;
        if (Math.abs(now.top - anchor.top) > 1 || Math.abs(now.left - anchor.left) > 1)
          panel.close();
      });
    };
    const offSheet = playerSheet.subscribe(() => {
      if (!playerSheet.getSnapshot().open) panel.close();
    });
    window.addEventListener("resize", follow);
    document.addEventListener("scroll", dismiss, { capture: true, passive: true });
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      offSheet();
      window.removeEventListener("resize", follow);
      document.removeEventListener("scroll", dismiss, { capture: true });
    };
  }, [open]);

  function show(): void {
    const panel = panelRef.current;
    if (!panel || panel.open) return;
    panel.showModal();
    // Measured once it is laid out, so the side is chosen from its real height. The scroll comes
    // first and the watch for scrolls starts after it (in the effect), so it cannot close the panel.
    makeRoom(panel, buttonRef.current);
    place(panel, buttonRef.current);
    panel.querySelector<HTMLElement>(".speed-slider")?.focus({ preventScroll: true });
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>): void {
    if (event.key !== "Escape") return;
    // Escape belongs to the panel while it is open: the player behind it stays.
    event.preventDefault();
    event.currentTarget.close();
  }

  const fill = (state.rate - MIN_PLAYBACK_RATE) / (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE);

  return (
    <div className="speed">
      <button
        ref={buttonRef}
        className="speed-btn num"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Playback speed ${rateLabel(state.rate)}`}
        onClick={show}
      >
        {rateFace(state.rate)}
      </button>
      <dialog
        ref={panelRef}
        id={panelId}
        className="speed-panel"
        aria-label="Playback speed"
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          // The backdrop is the dialog's own box: everything drawn inside it is a child.
          if (pressedBackdrop.current && event.target === event.currentTarget) {
            event.currentTarget.close();
          }
          pressedBackdrop.current = false;
        }}
        onClose={() => {
          setOpen(false);
          buttonRef.current?.focus({ preventScroll: true });
        }}
      >
        <div className="speed-panel-body">
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
          {/* The common speeds, a press away: the slider's steps are too fine to land on 1x by finger. */}
          <div className="speed-presets">
            {PLAYBACK_RATES.map((preset) => (
              <button
                key={preset}
                className="speed-preset num"
                type="button"
                aria-pressed={state.rate === preset}
                onClick={() => getPlayerStore().setRate(preset)}
              >
                {rateLabel(preset)}
              </button>
            ))}
          </div>
        </div>
      </dialog>
    </div>
  );
}

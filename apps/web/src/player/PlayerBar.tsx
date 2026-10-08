import { useEffect, useRef, useState } from "react";
import { formatClock } from "./core/formatTime";
import { errorSummary, isPlayingStatus, toggleLabel } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import { fractionOfTime } from "./core/scrubberMath";
import { applyVolume, getVolume, setVolume } from "./core/volume";
import { usePlayerFrame, usePlayerSecond, usePlayerState } from "./hooks/usePlayer";
import Clock from "./ui/Clock";
import Icon from "./ui/Icon";
import PlayerCover from "./ui/PlayerCover";
import PlayPauseGlyph from "./ui/PlayPauseGlyph";

/** The page the bar's open button controls. An element id, so it keeps the product's first name. */
export const PLAYER_PAGE_ID = "dispatch-player-page";

/**
 * The bar's own scrubber, along its top edge, on screens wide enough for the bar to stay put. A
 * native range input: the keyboard, a mouse and a finger all work without a line of gesture code.
 */
function DockSeek({ duration }: { duration: number }) {
  const store = getPlayerStore();
  const second = usePlayerSecond();
  const [drag, setDrag] = useState<number | null>(null);
  const max = Math.floor(duration);
  if (max <= 0) return null;
  const value = drag ?? Math.min(second, max);

  function commit(): void {
    if (drag === null) return;
    store.endScrub(drag);
    setDrag(null);
  }

  return (
    <input
      className="dock-seek"
      type="range"
      min={0}
      max={max}
      step={1}
      value={value}
      aria-label="Seek"
      aria-valuetext={`${formatClock(value)} of ${formatClock(max)}`}
      onChange={(event) => {
        const next = Number(event.currentTarget.value);
        // The audio waits while the thumb moves, and seeks once when it is let go.
        if (drag === null) store.beginScrub();
        store.scrubTo(next);
        setDrag(next);
      }}
      onPointerUp={commit}
      onPointerCancel={commit}
      onKeyUp={commit}
      onBlur={commit}
    />
  );
}

/** Mute and a level. Shown only where a page can set the volume: screens with a pointer. */
function DockVolume() {
  const [volume, setLevel] = useState(1);
  // The level to come back to after a mute.
  const lastAudible = useRef(1);

  useEffect(() => {
    const stored = getVolume();
    if (stored > 0) lastAudible.current = stored;
    setLevel(stored);
    applyVolume(stored);
  }, []);

  function change(next: number): void {
    if (next > 0) lastAudible.current = next;
    setLevel(next);
    setVolume(next);
  }

  const muted = volume === 0;
  return (
    <div className="dock-volume">
      <button
        className="dock-btn press"
        type="button"
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        onClick={() => change(muted ? lastAudible.current : 0)}
      >
        <Icon name={muted ? "volumeMute" : "volume"} />
      </button>
      <input
        className="dock-volume-level"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        aria-label="Volume"
        aria-valuetext={`${Math.round(volume * 100)} percent`}
        style={{ "--level": volume } as React.CSSProperties}
        onChange={(event) => change(Number(event.currentTarget.value))}
      />
    </div>
  );
}

/**
 * The dock: the bar at the bottom of the screen, and the collapsed end of the player surface. A
 * tap or a pull up anywhere on it that is not another control grows it into the page (the open
 * button's target is stretched over the whole bar in CSS); its cover is where the flying cover
 * leaves from. On a wide screen it stays put and keeps working while the page is open above it:
 * what is playing on the left, the transport in the middle, volume on the right.
 */
export default function PlayerBar() {
  const state = usePlayerState();
  const store = getPlayerStore();
  const second = usePlayerSecond();
  const fillRef = useRef<HTMLSpanElement>(null);

  // The playhead goes straight to a leaf element: React never renders at frame rate.
  usePlayerFrame((time, duration) => {
    fillRef.current?.style.setProperty(
      "--player-progress",
      fractionOfTime(time, duration).toFixed(5),
    );
  });

  const digest = state.track?.digest;
  const timeline = state.track?.timeline;
  const item = timeline?.items[state.itemIndex];
  const section = timeline?.sections[state.sectionIndex];
  const itemCount = timeline?.items.length ?? 0;
  const playing = isPlayingStatus(state.status);
  const headline = item?.headline ?? digest?.title ?? "";

  let caption =
    section && itemCount > 0
      ? `${section.title}, ${state.itemIndex + 1} of ${itemCount}`
      : (digest?.title ?? "");
  if (state.error) caption = errorSummary(state.error.kind);
  else if (state.interrupted) caption = "Interrupted, press play to resume";

  const isFirstItem = itemCount === 0 || state.itemIndex <= 0;
  const isLastItem = itemCount === 0 || state.itemIndex >= itemCount - 1;

  return (
    <section className="player-dock" aria-label="Audio player" data-player-dock>
      <div className="dock-progress" aria-hidden="true">
        <span className="dock-progress-fill" ref={fillRef} />
      </div>
      <DockSeek duration={state.duration} />
      <button
        className="dock-open"
        type="button"
        data-player-open
        aria-haspopup="dialog"
        // The surface controller keeps this in step with the page; false is the collapsed truth.
        aria-expanded="false"
        aria-controls={PLAYER_PAGE_ID}
        aria-label={`Open the player. ${headline}`}
        onClick={(event) =>
          playerSheet.click({ t: event.timeStamp, fromPointer: event.detail > 0 })
        }
      >
        <span className="player-thumb" data-player-thumb>
          {digest ? (
            <PlayerCover cover={digest.cover} weekly={digest.kind === "weekly"} size="thumb" />
          ) : null}
        </span>
        <span className="dock-text">
          <span className="dock-title">{headline}</span>
          <span className="dock-caption" data-tone={state.error ? "danger" : undefined}>
            {caption}
          </span>
        </span>
      </button>
      <div className="dock-transport">
        <button
          className="dock-btn dock-wide press"
          type="button"
          aria-label="Previous item"
          aria-disabled={isFirstItem || undefined}
          onClick={() => {
            if (!isFirstItem) store.previous();
          }}
        >
          <Icon name="skipBack" />
        </button>
        <button
          className="dock-btn press"
          type="button"
          data-primary
          data-playing={String(playing)}
          data-loading={String(state.buffering)}
          aria-label={toggleLabel(state)}
          aria-busy={state.buffering || undefined}
          onClick={() => store.toggle()}
        >
          <PlayPauseGlyph />
          <span className="spinner" aria-hidden="true" />
        </button>
        <button
          className="dock-btn press"
          type="button"
          aria-label="Next item"
          aria-disabled={isLastItem || undefined}
          onClick={() => {
            if (!isLastItem) store.next();
          }}
        >
          <Icon name="skipForward" />
        </button>
        <span className="dock-time dock-wide" aria-hidden="true">
          <Clock seconds={Math.min(second, state.duration)} />
          <span className="dock-time-of">/</span>
          <Clock seconds={state.duration} />
        </span>
      </div>
      <div className="dock-tools">
        <DockVolume />
      </div>
    </section>
  );
}

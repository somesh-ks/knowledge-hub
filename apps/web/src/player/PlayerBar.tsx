import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chapterMask } from "./core/chapterMask";
import { formatClock } from "./core/formatTime";
import {
  errorSummary,
  INTERRUPTED_LINE,
  isPlayingStatus,
  recordingCaption,
  toggleLabel,
} from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import { dockSeekKeyValue, fractionOfTime, scrubberValueText } from "./core/scrubberMath";
import { itemIndexAt, storyCaption, storySectionName } from "./core/timeline";
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
 * It holds the exact time, so its thumb sits where the line's fill and notch are; the keys still
 * step in whole seconds, as they did when the range stepped by one.
 */
function DockSeek({ duration }: { duration: number }) {
  const store = getPlayerStore();
  const second = usePlayerSecond();
  const state = usePlayerState();
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const bubble = drag ?? hover;
  const inputRef = useRef<HTMLInputElement>(null);
  // Under a resting mouse the thumb shows, and it follows the playhead every frame, as the line
  // does. Otherwise the value moves once a second: a slider that changed every frame while it had
  // keyboard focus would be read out every frame.
  usePlayerFrame((time) => {
    const input = inputRef.current;
    if (input?.matches(":hover:not(:focus-visible)")) input.value = String(time);
  });
  const whole = Math.floor(duration);
  if (whole <= 0) return null;
  const value = drag ?? Math.min(store.getTime(), duration);
  // What a screen reader hears stays in whole seconds, the story under the thumb included, so it
  // hears where a seek would land.
  const spoken = drag ?? Math.min(second, whole);
  const timeline = state.track?.timeline ?? null;
  const itemCount = timeline?.items.length ?? 0;
  // The story from the exact playhead: a story starting at 0:18.6 is the one heard at 0:18.6, which
  // the floored second would put in the rundown before it.
  const at = itemIndexAt(timeline, value);
  const section = timeline?.sections.find((entry) => entry.slug === timeline.items[at]?.section);

  function move(next: number): void {
    // The audio waits while the thumb moves, and seeks once when it is let go.
    if (drag === null) store.beginScrub();
    store.scrubTo(next);
    setDrag(next);
  }

  function commit(): void {
    if (drag === null) return;
    store.endScrub(drag);
    setDrag(null);
  }

  return (
    <>
      {bubble !== null ? (
        <output
          className="dock-seek-time num"
          data-hover={drag === null ? "" : undefined}
          style={
            { "--seek-at": fractionOfTime(bubble, duration).toFixed(4) } as React.CSSProperties
          }
        >
          {formatClock(bubble)}
        </output>
      ) : null}
      <input
        ref={inputRef}
        className="dock-seek"
        type="range"
        min={0}
        max={duration}
        step="any"
        value={value}
        aria-label="Seek"
        aria-valuetext={scrubberValueText(
          spoken,
          whole,
          storySectionName(state.track?.digest, section),
          at,
          itemCount,
        )}
        onChange={(event) => move(Number(event.currentTarget.value))}
        onKeyDown={(event) => {
          // A range with no step would move a hundredth of its length per key.
          const from = drag ?? store.getTime();
          const next = dockSeekKeyValue(event.key, from, duration);
          if (next === null) return;
          event.preventDefault();
          // As with the stepped range, a key that lands on the second it is in does nothing.
          if (next !== Math.min(Math.floor(from), whole)) move(next);
        }}
        // Under a resting mouse the clock shows where a click would land, before it is made.
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse" || drag !== null) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (box.width <= 0) return;
          const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
          setHover(share * duration);
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </>
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
 * button's target is stretched over the whole bar in CSS); below 64rem its cover is where the
 * flying cover leaves from. On a wide screen it stays put and keeps working while the page is open
 * above it, laid out as YouTube Music's is: the transport and the clock on the left, what is
 * playing in the middle, volume on the right.
 */
export default function PlayerBar() {
  const state = usePlayerState();
  const store = getPlayerStore();
  const second = usePlayerSecond();
  const lineRef = useRef<HTMLDivElement>(null);
  /** What last pressed the open button: a finger, a pen or a mouse. */
  const pressedBy = useRef("");

  // The playhead goes straight to the line, whose fill and notch read it: React never renders at
  // frame rate, and the line holds only those two.
  usePlayerFrame((time, duration) => {
    lineRef.current?.style.setProperty(
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
  // After a failure nothing is being read: the bar names the recording, not its first story.
  const headline = (state.error ? null : item?.headline) ?? digest?.title ?? "";

  // A story's place is told while one is being read. The rundown before story 1 is none, and
  // "Story 1 of 1" says nothing: the line then says what the recording is.
  let caption =
    item && section && itemCount > 1
      ? storyCaption(timeline ?? null, state.itemIndex, storySectionName(digest, section))
      : recordingCaption(digest, state.duration);
  if (state.error) caption = errorSummary(state.error.kind);
  else if (state.interrupted) caption = INTERRUPTED_LINE;

  // The bar shows once something has played, so what it holds is laid out: the timeline steps.
  // In the rundown before story 1, Previous goes to 0:00 and has nowhere further to go from there.
  const atStart = useSyncExternalStore(
    store.onSecond,
    () => store.getTime() <= 0,
    () => true,
  );
  const isLastItem = itemCount === 0 || state.itemIndex >= itemCount - 1;
  const step = {
    previousDisabled: itemCount === 0 || (state.itemIndex < 0 && atStart),
    nextDisabled: isLastItem,
    previous: () => {
      store.previous();
    },
    next: () => {
      if (!isLastItem) store.next();
    },
  };
  const open = useSyncExternalStore(
    playerSheet.subscribe,
    () => playerSheet.getSnapshot().open,
    () => false,
  );

  return (
    <section className="player-dock" aria-label="Audio player" data-player-dock>
      <div
        className="dock-progress"
        ref={lineRef}
        aria-hidden="true"
        style={
          {
            "--chapter-mask": chapterMask(
              state.track?.timeline?.items.map((entry) =>
                fractionOfTime(entry.startSec, state.duration),
              ) ?? [],
            ),
          } as React.CSSProperties
        }
      >
        <span className="dock-progress-fill" />
      </div>
      <DockSeek duration={state.duration} />
      <div className="dock-transport">
        {/* As on the page: on the first story, previous goes back to its start. */}
        <button
          className="dock-btn dock-wide press"
          type="button"
          aria-label="Previous story"
          aria-disabled={step.previousDisabled || undefined}
          onClick={step.previous}
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
          <PlayPauseGlyph status={state.status} />
          <span className="spinner" aria-hidden="true" />
        </button>
        <button
          className="dock-btn press"
          type="button"
          aria-label="Next story"
          aria-disabled={step.nextDisabled || undefined}
          onClick={step.next}
        >
          <Icon name="skipForward" />
        </button>
        <span className="dock-time dock-wide" aria-hidden="true">
          <Clock seconds={Math.min(second, state.duration)} widest={state.duration} />
          <span className="dock-time-of">/</span>
          <Clock seconds={state.duration} />
        </span>
      </div>
      <button
        className="dock-open"
        type="button"
        data-player-open
        aria-haspopup="dialog"
        // The surface controller keeps this in step with the page; false is the collapsed truth.
        aria-expanded="false"
        aria-controls={PLAYER_PAGE_ID}
        aria-label={`Player: ${headline}`}
        onClick={(event) =>
          playerSheet.click({ t: event.timeStamp, fromPointer: event.detail > 0 })
        }
        onPointerDown={(event) => {
          pressedBy.current = event.pointerType;
        }}
        // A tap opens the page on the finger's lift, and focus moves into it. The mouse press a
        // browser sends after a tap would then take focus back to this button, which a wide window
        // keeps in reach under the open page, and the next Tab would start from nothing.
        onMouseDown={(event) => {
          if (pressedBy.current === "touch") event.preventDefault();
        }}
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
      <div className="dock-tools">
        <DockVolume />
        {/* What the whole bar does, said where a mouse looks for it: open the page, or close it. */}
        <button
          className="dock-btn dock-toggle press"
          type="button"
          aria-expanded={open}
          aria-controls={PLAYER_PAGE_ID}
          aria-label={open ? "Close the player" : "Open the player"}
          data-open={open ? "" : undefined}
          onClick={(event) =>
            playerSheet.click({ t: event.timeStamp, fromPointer: event.detail > 0 })
          }
        >
          <svg className="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
            <path d="M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z" />
          </svg>
        </button>
      </div>
    </section>
  );
}

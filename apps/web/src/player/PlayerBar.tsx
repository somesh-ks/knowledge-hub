import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chapterMask } from "./core/chapterMask";
import { formatClock } from "./core/formatTime";
import { heldTap } from "./core/heldTap";
import {
  errorSummary,
  INTERRUPTED_LINE,
  isPlayingStatus,
  recordingCaption,
  recordingKind,
  toggleLabel,
} from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import { dockSeekKeyValue, fractionOfTime, scrubberValueText } from "./core/scrubberMath";
import { itemIndexAt, storySectionName } from "./core/timeline";
import { applyVolume, getVolume, setVolume } from "./core/volume";
import { usePlayerFrame, usePlayerSecond, usePlayerState } from "./hooks/usePlayer";
import Clock from "./ui/Clock";
import Icon from "./ui/Icon";
import PlayerCover from "./ui/PlayerCover";
import PlayPauseGlyph from "./ui/PlayPauseGlyph";

/** The page the bar's open button controls. An element id, so it keeps the product's first name. */
export const PLAYER_PAGE_ID = "singularity-player-page";

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

/** Expands the player, or lowers it when open. Desktop only, because it lives in dock-tools. */
function DockExpand() {
  const open = useSyncExternalStore(
    playerSheet.subscribe,
    () => playerSheet.getSnapshot().open,
    () => false,
  );
  return (
    <button
      className="icon-btn press dock-expand"
      type="button"
      aria-expanded={open}
      aria-controls={PLAYER_PAGE_ID}
      aria-label={open ? "Collapse player" : "Expand player"}
      onClick={() => void playerSheet.toggle()}
    >
      <Icon name="chevronDown" />
    </button>
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
    // The level comes first, so the button holds the bar's right edge and the level opens to its
    // left; focus moves in the order the eye reads.
    <div className="dock-volume">
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
      <button
        className="dock-btn press"
        type="button"
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        onClick={() => change(muted ? lastAudible.current : 0)}
      >
        <Icon name={muted ? "volumeMute" : "volume"} />
      </button>
    </div>
  );
}

/**
 * The dock: the bar at the bottom of the screen, and the collapsed end of the player surface. A
 * tap or a pull up anywhere on it that is not another control grows it into the page (the open
 * button's target is stretched over the whole bar in CSS); below 64rem its cover is where the
 * flying cover leaves from. On a wide screen it stays put and keeps working while the page is open
 * above it, laid out as YouTube Music's is: what is playing on the left, the transport and the
 * clock in the middle, volume on the right.
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
  // The bar's line is the story's chapter, a few words that fit; the full headline stays the
  // button's name. A story written before chapters shows its headline.
  const title = (state.error ? null : (item?.chapter ?? item?.headline)) ?? digest?.title ?? "";

  // Under the title: the clock, then the story's section, or what the recording is before story 1
  // and in an episode, which has no sections. A failure or an interruption takes the line.
  const where =
    (item && section ? storySectionName(digest, section) : "") ||
    (digest ? recordingKind(digest) : "");
  const notice = state.error
    ? errorSummary(state.error)
    : state.interrupted
      ? INTERRUPTED_LINE
      : null;

  // The bar shows once something has played, so what it holds is laid out: the timeline steps.
  // In the rundown before story 1, Previous goes to 0:00 and has nowhere further to go from there.
  const atStart = useSyncExternalStore(
    store.onSecond,
    () => store.getTime() <= 0,
    () => true,
  );
  const isLastItem = itemCount === 0 || state.itemIndex >= itemCount - 1;

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
          <span className="dock-title" key={item?.id ?? "title"}>
            {title}
          </span>
          <span className="dock-caption" data-tone={state.error ? "danger" : undefined}>
            {notice ??
              (state.duration > 0 ? (
                <>
                  <Clock seconds={Math.min(second, state.duration)} widest={state.duration} />
                  {" / "}
                  <Clock seconds={state.duration} />
                  {where ? ` \u00b7 ${where}` : ""}
                </>
              ) : (
                recordingCaption(digest, state.duration)
              ))}
          </span>
        </span>
      </button>
      <div className="dock-transport">
        {/* As on the page: on the first story, previous goes back to its start. */}
        <button
          className="dock-btn dock-wide press"
          type="button"
          aria-label="Previous story"
          aria-disabled={itemCount === 0 || (state.itemIndex < 0 && atStart) || undefined}
          {...heldTap(() => store.previous())}
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
          {...heldTap(() => store.toggle())}
        >
          <PlayPauseGlyph status={state.status} error={state.error} />
          <span className="spinner" aria-hidden="true" />
        </button>
        <button
          className="dock-btn press"
          type="button"
          aria-label="Next story"
          aria-disabled={isLastItem || undefined}
          {...heldTap(() => isLastItem || store.next())}
        >
          <Icon name="skipForward" />
        </button>
      </div>
      <div className="dock-tools">
        <DockVolume />
        <DockExpand />
      </div>
    </section>
  );
}

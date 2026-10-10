import { useEffect, useMemo, useRef, useState } from "react";
import { hostOf } from "../lib/hosts";
import type { SegmentWordMark } from "../lib/segmentMarks";
import { getPlayerStore } from "./core/playerRuntime";
import {
  currentTurnIndex,
  estimateWordStarts,
  FOLLOW_PAUSE_MS,
  markedWordStarts,
  splitWords,
  turnEndMs,
  wordIndexAt,
} from "./core/scriptMath";
import { usePlayerSecond, usePlayerState } from "./hooks/usePlayer";

/**
 * An episode's transcript, in the open player: every turn in order with its speaker, the turn being
 * spoken marked and kept in view, and the word being said lit as it is said. A tap on a word plays
 * from it. It follows the voice until a person scrolls it, then waits a few seconds, and offers a
 * way back.
 */
export default function ScriptView({ titleHidden = false }: { titleHidden?: boolean }) {
  const state = usePlayerState();
  const second = usePlayerSecond();
  const turns = state.track?.digest.turns ?? [];
  const current = state.hasStarted ? currentTurnIndex(turns, second) : -1;
  const rootRef = useRef<HTMLElement>(null);
  const pausedUntil = useRef(0);
  // Opening the page shows its top. Following starts when the voice moves to another turn.
  const followed = useRef<number | null>(null);
  const [away, setAway] = useState(false);
  const digestId = state.track?.digest.id;
  // Speechify's word marks, by segment key, for the turns that have been near the voice.
  const [marks, setMarks] = useState<Record<string, SegmentWordMark[]>>({});
  const words = useMemo(
    () =>
      turns.map((turn, index) => {
        const list = splitWords(turn.text);
        const estimate = estimateWordStarts(list, turn.start_ms, turnEndMs(turns, index));
        return {
          list,
          starts: markedWordStarts(list.length, marks[turn.key], turn.start_ms, estimate),
        };
      }),
    [turns, marks],
  );

  // The turn being spoken and the next: their marks, once each, on demand. A miss keeps the estimate.
  useEffect(() => {
    if (current < 0 || !digestId) return;
    let live = true;
    for (const turn of turns.slice(current, current + 2)) {
      if (turn.start_ms === null) continue;
      void import("./core/wordMarks")
        .then(({ loadWordMarks }) => loadWordMarks(digestId, turn.key))
        .then((found) => {
          if (live && found && found.length > 0)
            setMarks((known) => (known[turn.key] ? known : { ...known, [turn.key]: found }));
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [current, digestId, turns]);

  // The spoken word, at frame rate, without a render: one attribute moves from word to word.
  useEffect(() => {
    let lit: Element | null = null;
    const light = (seconds: number): void => {
      const ms = seconds * 1000;
      const turn = getPlayerStore().getState().hasStarted ? currentTurnIndex(turns, seconds) : -1;
      const starts = turn >= 0 ? words[turn]?.starts : null;
      const word = starts ? wordIndexAt(starts, ms) : -1;
      const next =
        word >= 0
          ? (rootRef.current?.querySelector(`[data-turn="${turn}"] [data-word="${word}"]`) ?? null)
          : null;
      if (next === lit) return;
      lit?.removeAttribute("data-spoken");
      next?.setAttribute("data-spoken", "");
      lit = next;
    };
    const store = getPlayerStore();
    light(store.getTime());
    const off = store.onFrame((seconds) => light(seconds));
    return () => {
      off();
      lit?.removeAttribute("data-spoken");
    };
  }, [turns, words]);

  function reveal(index: number): void {
    // The page holds still under a dialog (the speed panel), which would otherwise lose its button.
    if (document.querySelector("dialog[open]")) return;
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-turn="${index}"]`);
    // On a wide screen the script is its own column and the turn is centred in it. On one column
    // the page also holds the cover and the controls, so it moves only as far as the turn needs.
    const column = window.matchMedia("(min-width: 64rem)").matches;
    // Under reduced motion it jumps: a scripted glide is movement the person asked not to see.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node?.scrollIntoView({
      block: column ? "center" : "nearest",
      behavior: still ? "instant" : "smooth",
    });
  }

  // Follows the voice, unless a person is reading elsewhere.
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs when the turn changes
  useEffect(() => {
    if (current < 0) return;
    const first = followed.current === null;
    followed.current = current;
    if (first) return;
    if (Date.now() < pausedUntil.current) {
      setAway(true);
      return;
    }
    setAway(false);
    reveal(current);
  }, [current]);

  // A wheel or a finger on the script or the page means the person is in charge for a while.
  useEffect(() => {
    const page = rootRef.current?.closest<HTMLElement>("[data-player-page]");
    const hold = (): void => {
      pausedUntil.current = Date.now() + FOLLOW_PAUSE_MS;
    };
    const targets = [rootRef.current, page];
    for (const target of targets) {
      target?.addEventListener("wheel", hold, { passive: true });
      target?.addEventListener("touchmove", hold, { passive: true });
    }
    return () => {
      for (const target of targets) {
        target?.removeEventListener("wheel", hold);
        target?.removeEventListener("touchmove", hold);
      }
    };
  }, []);

  if (turns.length === 0) return null;
  return (
    <section className="player-script" ref={rootRef} aria-labelledby="player-script-title">
      <h3 className={titleHidden ? "sr-only" : "player-section-title"} id="player-script-title">
        Transcript
      </h3>
      <ol className="script-turns" data-following={current >= 0 ? "" : undefined}>
        {turns.map((turn, index) => {
          const host = hostOf(turn.speaker);
          return (
            <li key={turn.key}>
              <button
                className="script-turn"
                type="button"
                data-turn={index}
                data-said={current >= 0 && index < current ? "" : undefined}
                aria-current={index === current ? "true" : undefined}
                aria-disabled={turn.start_ms === null ? "true" : undefined}
                onClick={(event) => {
                  if (turn.start_ms === null) return;
                  pausedUntil.current = 0;
                  // A tap on a word plays from that word; anywhere else in the turn, from its start.
                  const word = (event.target as Element).closest<HTMLElement>("[data-word]");
                  const at = word ? words[index]?.starts?.[Number(word.dataset.word)] : undefined;
                  getPlayerStore().seekTo(Math.round(at ?? turn.start_ms));
                }}
              >
                <span className="script-speaker">{host.name}</span>
                <span className="script-text">
                  {words[index]?.list.map((word, at) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a turn's words never reorder
                    <span key={at}>
                      {at > 0 ? " " : null}
                      <span className="script-word" data-word={at}>
                        {word}
                      </span>
                    </span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {away ? (
        <button
          className="script-back"
          type="button"
          onClick={() => {
            pausedUntil.current = 0;
            // The button goes away with this press; keyboard focus moves to the turn it points at.
            rootRef.current
              ?.querySelector<HTMLElement>(`[data-turn="${current}"]`)
              ?.focus({ preventScroll: true });
            setAway(false);
            if (current >= 0) reveal(current);
          }}
        >
          Back to now
        </button>
      ) : null}
    </section>
  );
}

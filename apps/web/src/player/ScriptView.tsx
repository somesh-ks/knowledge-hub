import { useEffect, useMemo, useRef, useState } from "react";
import { hostOf, needsVoiceList, readHostNames, readVoiceIds, transcriptNames } from "../lib/hosts";
import type { SegmentWordMark } from "../lib/segmentMarks";
import { loadVoiceCatalogue, type VoiceCatalogue } from "./core/hostVoices";
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
import { useRovingFocus } from "./hooks/useRovingFocus";

/**
 * An episode's transcript, in the open player: every turn in order with its speaker, the turn being
 * spoken marked and kept in view, and the word being said lit as it is said. A tap on a word plays
 * from it. It follows the voice until a person scrolls it, then waits a few seconds, and offers a
 * way back.
 */
/**
 * The script may follow the voice: always in its own column from 64rem, and on one column only
 * once the listener has scrolled it up into the upper half of the screen themselves. Where the
 * page opens (the script's top near the fold) a turn change never scrolls the page.
 */
function oneColumnFollows(root: HTMLElement | null): boolean {
  if (!root || window.matchMedia("(min-width: 64rem)").matches) return true;
  return root.getBoundingClientRect().top < window.innerHeight / 2;
}

export default function ScriptView({ titleHidden = false }: { titleHidden?: boolean }) {
  const state = usePlayerState();
  // A render each second, and after a seek while paused. The turn itself is read from the playhead,
  // not from the floored second, which kept the last turn marked for most of a second after a jump
  // into the next one; the frame loop below renders again the moment the spoken turn changes.
  usePlayerSecond();
  const [, setTurnMoved] = useState(0);
  const spokenTurn = useRef(-1);
  const turns = state.track?.digest.turns ?? [];
  const current =
    state.hasStarted && !state.error ? currentTurnIndex(turns, getPlayerStore().getTime()) : -1;
  // After a failure nothing is being read: no turn is current and no word is lit.
  const failed = state.error !== null;
  const rootRef = useRef<HTMLElement>(null);
  const pausedUntil = useRef(0);
  // Opening the page shows its top. Following starts when the voice moves to another turn.
  const followed = useRef<number | null>(null);
  // A turn changed while the listener was reading elsewhere; "away" adds that the turn is out of view.
  const [held, setAway] = useState(false);
  const [turnInView, setTurnInView] = useState(true);
  const away = held && !turnInView;
  const digestId = state.track?.digest.id;
  // Nobody is named in an episode with one voice; a discussion names each host after their voice.
  // One made before names were stored is named from its voices, once the voice list is here.
  const storedHosts = state.track?.digest.hosts;
  const voiceIds = state.track?.digest.voices;
  const [catalogue, setCatalogue] = useState<VoiceCatalogue | null | undefined>(undefined);
  const wantsVoices = needsVoiceList(turns, readHostNames(storedHosts));
  useEffect(() => {
    if (!wantsVoices || catalogue !== undefined) return;
    let live = true;
    void loadVoiceCatalogue().then((found) => {
      if (live) setCatalogue(found);
    });
    return () => {
      live = false;
    };
  }, [wantsVoices, catalogue]);
  const names = useMemo(
    () =>
      transcriptNames(
        turns,
        readHostNames(storedHosts),
        catalogue ? { ids: readVoiceIds(voiceIds), ...catalogue } : catalogue,
      ),
    [turns, storedHosts, voiceIds, catalogue],
  );
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
      // After a failure no word is lit: the effect runs again when `failed` changes, and clears it.
      const turn =
        getPlayerStore().getState().hasStarted && !failed ? currentTurnIndex(turns, seconds) : -1;
      if (turn !== spokenTurn.current) {
        spokenTurn.current = turn;
        setTurnMoved((count) => count + 1);
      }
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
  }, [turns, words, failed]);

  // Whether the turn being spoken is on screen: the pill that leads back to it is for when it is not.
  useEffect(() => {
    const node =
      current >= 0 ? rootRef.current?.querySelector<HTMLElement>(`[data-turn="${current}"]`) : null;
    if (!node || typeof IntersectionObserver === "undefined") {
      setTurnInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setTurnInView(last.isIntersecting);
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [current]);

  function reveal(index: number): void {
    // The page holds still under a dialog (the speed panel), which would otherwise lose its button.
    if (document.querySelector("dialog[open]")) return;
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-turn="${index}"]`);
    // On a wide screen the script is its own column and the turn is centred in it. On one column
    // the page also holds the cover and the controls, so it moves only as far as the turn needs.
    const column = window.matchMedia("(min-width: 64rem)").matches;
    // Under reduced motion it jumps: a scripted glide is movement the person asked not to see.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = still ? "instant" : "smooth";
    const list = rootRef.current?.querySelector<HTMLElement>(".list-scroll");
    if (column && node && list) {
      // Only the list moves: scrollIntoView would scroll the page too, where the left column
      // is taller than a short window (a tablet held sideways).
      const top =
        list.scrollTop +
        (node.getBoundingClientRect().top - list.getBoundingClientRect().top) -
        (list.clientHeight - node.offsetHeight) / 2;
      list.scrollTo({ top, behavior });
      return;
    }
    node?.scrollIntoView({ block: "nearest", behavior });
  }

  // Follows the voice, unless a person is reading elsewhere.
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs when the turn changes
  useEffect(() => {
    if (current < 0) return;
    const first = followed.current === null;
    followed.current = current;
    if (first) return;
    // On one column the page holds the cover and the controls above the script. While the script
    // is below the fold the listener is not reading it, and the page stays where they put it.
    const root = rootRef.current;
    if (!oneColumnFollows(root)) {
      setAway(false);
      return;
    }
    if (Date.now() < pausedUntil.current) {
      setAway(true);
      return;
    }
    setAway(false);
    reveal(current);
  }, [current]);

  // A wheel or a finger on the script or the page means the person is in charge for a while. So
  // does any move made with the controls on one column (a story step, a scrubber key or drag):
  // following it would scroll the page and carry the control being used off screen, so that a
  // second tap lands on a turn. From 64rem the script scrolls in its own column and keeps following.
  useEffect(() => {
    const page = rootRef.current?.closest<HTMLElement>("[data-player-page]");
    const hold = (): void => {
      pausedUntil.current = Date.now() + FOLLOW_PAUSE_MS;
    };
    const holdForControls = (event: Event): void => {
      if (window.matchMedia("(min-width: 64rem)").matches) return;
      if (event.target instanceof Element && event.target.closest(".player-controls")) hold();
    };
    const targets = [rootRef.current, page];
    for (const target of targets) {
      target?.addEventListener("wheel", hold, { passive: true });
      target?.addEventListener("touchmove", hold, { passive: true });
    }
    page?.addEventListener("pointerdown", holdForControls, { capture: true });
    page?.addEventListener("keydown", holdForControls, { capture: true });
    return () => {
      for (const target of targets) {
        target?.removeEventListener("wheel", hold);
        target?.removeEventListener("touchmove", hold);
      }
      page?.removeEventListener("pointerdown", holdForControls, { capture: true });
      page?.removeEventListener("keydown", holdForControls, { capture: true });
    };
  }, []);

  // The transcript is one Tab stop (the turn being spoken, or the one focused last); the arrow keys,
  // Home and End move between turns, and Enter plays the focused one.
  useRovingFocus(rootRef, ".script-turn", turns.length > 0);

  if (turns.length === 0) return null;
  return (
    <section className="player-script" ref={rootRef} aria-labelledby="player-script-title">
      <h3 className={titleHidden ? "sr-only" : "player-section-title"} id="player-script-title">
        Transcript
      </h3>
      <div className="list-scroll">
        <ol className="script-turns" data-following={current >= 0 ? "" : undefined}>
          {turns.map((turn, index) => {
            const host = hostOf(turn.speaker, names);
            // A name goes where the speaker changes: a second turn from the same voice just continues.
            const named = host.name !== null && turns[index - 1]?.speaker !== turn.speaker;
            return (
              <li key={turn.key}>
                <button
                  className="script-turn"
                  type="button"
                  data-turn={index}
                  data-tone={host.tone}
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
                  {named ? <span className="script-speaker">{host.name}</span> : null}
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
      </div>
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

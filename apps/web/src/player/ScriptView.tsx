import { useEffect, useRef, useState } from "react";
import { hostOf } from "../lib/hosts";
import { getPlayerStore } from "./core/playerRuntime";
import { currentTurnIndex, FOLLOW_PAUSE_MS } from "./core/scriptMath";
import { usePlayerSecond, usePlayerState } from "./hooks/usePlayer";

/**
 * An episode's script, in the open player: every turn in order with its speaker, the turn being
 * spoken marked and kept in view, and a tap on a turn to hear it. It follows the voice until a
 * person scrolls it, then waits a few seconds, and offers a way back.
 */
export default function ScriptView() {
  const state = usePlayerState();
  const second = usePlayerSecond();
  const turns = state.track?.digest.turns ?? [];
  const current = state.hasStarted ? currentTurnIndex(turns, second) : -1;
  const rootRef = useRef<HTMLElement>(null);
  const pausedUntil = useRef(0);
  // Opening the page shows its top. Following starts when the voice moves to another turn.
  const followed = useRef<number | null>(null);
  const [away, setAway] = useState(false);

  function reveal(index: number): void {
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-turn="${index}"]`);
    // On a wide screen the script is its own column and the turn is centred in it. On one column
    // the page also holds the cover and the controls, so it moves only as far as the turn needs.
    const column = window.matchMedia("(min-width: 64rem)").matches;
    node?.scrollIntoView({ block: column ? "center" : "nearest", behavior: "smooth" });
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
      <h3 className="player-section-title" id="player-script-title">
        Script
      </h3>
      <ol className="script-turns">
        {turns.map((turn, index) => {
          const host = hostOf(turn.speaker);
          return (
            <li key={turn.key}>
              <button
                className="script-turn press"
                type="button"
                data-turn={index}
                data-tone={host.tone}
                aria-current={index === current ? "true" : undefined}
                aria-disabled={turn.start_ms === null ? "true" : undefined}
                onClick={() => {
                  if (turn.start_ms === null) return;
                  pausedUntil.current = 0;
                  getPlayerStore().seekTo(turn.start_ms);
                }}
              >
                <span className="script-speaker">
                  <span className="host-badge" aria-hidden="true">
                    {host.initial}
                  </span>
                  <span className="script-name">{host.name}</span>
                </span>
                <span className="script-text">{turn.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {away ? (
        <button
          className="script-back press"
          type="button"
          onClick={() => {
            pausedUntil.current = 0;
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

import { useEffect, useSyncExternalStore } from "react";
import "../styles/player.css";
import { startPlayerRuntime } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import {
  getExpandedPlayer,
  loadExpandedPlayer,
  subscribeExpandedPlayer,
} from "./expandedPlayerLoader";
import { usePlayerState } from "./hooks/usePlayer";
import { useSheetPresence } from "./hooks/useSheetPresence";
import PlayerBar from "./PlayerBar";

function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task, { timeout: 4_000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 2_000);
  return () => clearTimeout(handle);
}

/**
 * The player island. Mount it once in the base layout as a persistent `client:idle` island: it
 * owns the audio store's wiring (Media Session, the reader coupling, announcements, sounds) and
 * renders the mini player. The expanded player is a separate chunk, fetched when the browser is
 * idle, so reading and pressing play never wait on it.
 */
export default function PlayerRoot() {
  const presence = useSheetPresence();
  const state = usePlayerState();
  const coverSrc = state.track?.digest.cover.src1024;
  const ExpandedPlayer = useSyncExternalStore(
    subscribeExpandedPlayer,
    getExpandedPlayer,
    () => null,
  );

  useEffect(() => startPlayerRuntime(), []);
  useEffect(() => {
    // Ready before it is wanted. If it is wanted sooner, fetch it now.
    if (presence) {
      // The sheet was asked for and its code never arrived: give the screen back.
      loadExpandedPlayer().catch(() => playerSheet.close());
      return;
    }
    return whenIdle(() => {
      // Nothing is waiting on this one, so a failure just means the next open tries again.
      loadExpandedPlayer().catch(() => undefined);
    });
  }, [presence]);
  useEffect(() => {
    if (!coverSrc) return;
    // Decode the large cover ahead of time, so the morph never starts on an empty box.
    return whenIdle(() => {
      const image = new Image();
      image.src = coverSrc;
      void image.decode?.().catch(() => undefined);
    });
  }, [coverSrc]);

  return (
    <>
      <PlayerBar />
      {presence && ExpandedPlayer ? <ExpandedPlayer /> : null}
    </>
  );
}

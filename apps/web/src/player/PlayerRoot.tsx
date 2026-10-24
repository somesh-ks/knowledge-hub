import { useEffect } from "react";
import "../styles/player.css";
import { loadPlayerSheet } from "./core/playerSheet";
import { usePlayerState } from "./hooks/usePlayer";
import PlayerSurface from "./PlayerSurface";
import { loadPageContent } from "./pageContentLoader";

function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task, { timeout: 4_000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 2_000);
  return () => clearTimeout(handle);
}

/**
 * The player island. Mount it once in the base layout as a persistent `client:wake` island: it
 * renders the player surface over the audio store, whose wiring (Media Session, the reader coupling,
 * announcements, sounds) the layout's script starts at load, without React. The page's controls are a separate chunk, fetched when the browser
 * is idle, so reading and pressing play never wait on them.
 */
export default function PlayerRoot() {
  const coverSrc = usePlayerState().track?.digest.cover.src1024;

  // Ready before it is wanted: the open page's controls and the surface's motion. A failure here
  // is retried at the first touch on the bar.
  useEffect(
    () =>
      whenIdle(() => {
        void loadPageContent();
        void loadPlayerSheet().catch(() => undefined);
      }),
    [],
  );
  useEffect(() => {
    if (!coverSrc) return;
    // Decode the large cover ahead of time, so the flight never starts on an empty box.
    return whenIdle(() => {
      const image = new Image();
      image.src = coverSrc;
      void image.decode?.().catch(() => undefined);
    });
  }, [coverSrc]);

  return <PlayerSurface />;
}

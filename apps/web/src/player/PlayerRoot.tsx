import { useEffect } from "react";
import "../styles/player.css";
import { startPlayerRuntime } from "./core/playerRuntime";
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
 * The player island. Mount it once in the base layout as a persistent `client:idle` island: it
 * owns the audio store's wiring (Media Session, the reader coupling, announcements, sounds) and
 * renders the player surface. The page's controls are a separate chunk, fetched when the browser
 * is idle, so reading and pressing play never wait on them.
 */
export default function PlayerRoot() {
  const coverSrc = usePlayerState().track?.digest.cover.src1024;

  useEffect(() => startPlayerRuntime(), []);
  // Ready before it is wanted. A failure here is retried at the first touch on the bar.
  useEffect(() => whenIdle(() => void loadPageContent()), []);
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

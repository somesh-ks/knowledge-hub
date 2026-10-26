import { type CSSProperties, useEffect, useState } from "react";
import type { PlayerDigestData } from "../../types/contracts";

const MODES = ["light", "dark"] as const;

/** A cover the site drew: its path comes from page JSON, so anything else is not shown. */
const COVER_FILE = /^\/covers\/([\w-]+\.(?:webp|png))(\?v=\w+)?$/;

/** The cover drawn for one theme: `/covers/x-512.webp` becomes `/covers/dark/x-512.webp`. */
function themedSrc(src: string, mode: (typeof MODES)[number]): string {
  const match = COVER_FILE.exec(src);
  const file = match?.[1];
  // encodeURIComponent changes nothing the pattern lets through; it marks the path safe for CodeQL.
  return file ? `/covers/${mode}/${encodeURIComponent(file)}${match?.[2] ?? ""}` : "";
}

/** The theme the page is showing: an explicit data-theme wins, else the system's. */
function shownMode(): (typeof MODES)[number] {
  const theme = document.documentElement.dataset.theme;
  if (theme === "light" || theme === "dark") return theme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface PlayerCoverProps {
  cover: PlayerDigestData["cover"];
  /** Weekly deep dives carry a framing rule so they read as a different record at a glance. */
  weekly: boolean;
  /** "thumb" on the bar. "player" on the page and in flight, where it fills the box it is given. */
  size: "thumb" | "player";
}

/**
 * The cover as the player shows it: a decorative image (the title sits beside it) on a box in the
 * palette's key color, so there is no empty flash while the PNG decodes. The player draws it three
 * times (on the bar, on the page, in flight). Below 64rem, where motion is allowed, its stylesheet
 * shows exactly one of them at a time; elsewhere the bar and the page each keep their own.
 */
export default function PlayerCover({ cover, weekly, size }: PlayerCoverProps) {
  const style = { "--cover-key": cover.key } as CSSProperties;
  // Pending (no drawn path), missing or failed to load: the branded fallback (cover.css), never a
  // broken or empty box. A new cover path gets a new try. A failure counts for its own theme only:
  // the other theme's image may be fine, and the page can switch to it.
  const [failed, setFailed] = useState<{ src: string; modes: readonly string[] }>({
    src: "",
    modes: [],
  });
  const [shown, setShown] = useState<(typeof MODES)[number]>("light");
  useEffect(() => {
    const sync = () => setShown(shownMode());
    sync();
    const query = matchMedia("(prefers-color-scheme: dark)");
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    query.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", sync);
    };
  }, []);
  const fallback =
    !themedSrc(cover.src512, "light") ||
    (failed.src === cover.src512 && failed.modes.includes(shown));
  return (
    <span
      className="player-cover-frame"
      data-size={size}
      data-weekly={weekly ? "" : undefined}
      data-fallback={fallback ? "" : undefined}
      style={style}
    >
      {MODES.map((mode) => {
        const src = themedSrc(cover.src512, mode);
        // A path that is not a drawn cover leaves the key-colored box, never an empty src.
        if (!src) return null;
        return (
          <img
            key={mode}
            className="player-cover-image"
            data-mode={mode}
            src={src}
            srcSet={
              size === "player" ? `${src} 512w, ${themedSrc(cover.src1024, mode)} 1024w` : undefined
            }
            sizes={size === "player" ? "(min-width: 40rem) 22rem, calc(100vw - 3rem)" : undefined}
            alt=""
            width={size === "thumb" ? 44 : 352}
            height={size === "thumb" ? 44 : 352}
            decoding="async"
            // The other theme's image is display: none, so a lazy one is never fetched.
            loading="lazy"
            draggable={false}
            onError={() =>
              setFailed((prev) => ({
                src: cover.src512,
                modes: [...(prev.src === cover.src512 ? prev.modes : []), mode],
              }))
            }
          />
        );
      })}
    </span>
  );
}

/**
 * The light the cover gives while it plays: the cover itself, blurred, behind the page's cover. It is
 * the cover's own colours by construction. player.css fades it in while playing and lets it breathe.
 */
export function PlayerCoverGlow({ cover }: { cover: PlayerDigestData["cover"] }) {
  return (
    <span className="player-cover-glow" aria-hidden="true">
      <span className="player-cover-glow-light">
        {MODES.map((mode) => {
          const src = themedSrc(cover.src512, mode);
          if (!src) return null;
          return (
            <img
              key={mode}
              className="player-cover-image"
              data-mode={mode}
              src={src}
              alt=""
              width={352}
              height={352}
              decoding="async"
              loading="lazy"
              draggable={false}
            />
          );
        })}
      </span>
    </span>
  );
}

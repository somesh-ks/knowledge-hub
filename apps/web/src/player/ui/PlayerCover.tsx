import type { CSSProperties } from "react";
import type { PlayerDigestData } from "../../types/contracts";

const MODES = ["light", "dark"] as const;

/** The cover drawn for one theme: `/covers/x-512.webp` becomes `/covers/dark/x-512.webp`. */
function themedSrc(src: string, mode: (typeof MODES)[number]): string {
  return src.replace(/^\/covers\//, `/covers/${mode}/`);
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
  return (
    <span
      className="player-cover-frame"
      data-size={size}
      data-weekly={weekly ? "" : undefined}
      style={style}
    >
      {MODES.map((mode) => (
        <img
          key={mode}
          className="player-cover-image"
          data-mode={mode}
          src={themedSrc(cover.src512, mode)}
          srcSet={
            size === "player"
              ? `${themedSrc(cover.src512, mode)} 512w, ${themedSrc(cover.src1024, mode)} 1024w`
              : undefined
          }
          sizes={size === "player" ? "(min-width: 40rem) 22rem, calc(100vw - 3rem)" : undefined}
          alt=""
          width={size === "thumb" ? 44 : 352}
          height={size === "thumb" ? 44 : 352}
          decoding="async"
          // The other theme's image is display: none, so a lazy one is never fetched.
          loading="lazy"
          draggable={false}
        />
      ))}
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
        {MODES.map((mode) => (
          <img
            key={mode}
            className="player-cover-image"
            data-mode={mode}
            src={themedSrc(cover.src512, mode)}
            alt=""
            width={352}
            height={352}
            decoding="async"
            loading="lazy"
            draggable={false}
          />
        ))}
      </span>
    </span>
  );
}

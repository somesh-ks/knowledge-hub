import type { CSSProperties } from "react";
import type { PlayerDigestData } from "../../types/contracts";

interface PlayerCoverProps {
  cover: PlayerDigestData["cover"];
  /** Weekly deep dives carry a framing rule so they read as a different record at a glance. */
  weekly: boolean;
  size: "thumb" | "player";
  /** The mini player's cover, the other end of the shared element the sheet morphs from. */
  isMini?: boolean;
}

/**
 * The cover as the player shows it: a decorative image (the title sits beside it) on a box in the
 * palette's key color, so there is no empty flash while the PNG decodes.
 */
export default function PlayerCover({ cover, weekly, size, isMini = false }: PlayerCoverProps) {
  const style = { "--cover-key": cover.key } as CSSProperties;
  return (
    <span
      className="player-cover-frame"
      data-size={size}
      data-weekly={weekly ? "" : undefined}
      data-mini-cover={isMini ? "" : undefined}
      style={style}
    >
      <img
        className="player-cover-image"
        src={cover.src512}
        srcSet={size === "player" ? `${cover.src512} 512w, ${cover.src1024} 1024w` : undefined}
        sizes={size === "player" ? "(min-width: 40rem) 22rem, calc(100vw - 3rem)" : undefined}
        alt=""
        width={size === "thumb" ? 44 : 352}
        height={size === "thumb" ? 44 : 352}
        decoding="async"
        draggable={false}
      />
    </span>
  );
}

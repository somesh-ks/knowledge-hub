import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { PlayerDigestData } from "../../types/contracts";

/** A cover the site drew: its path comes from page JSON, so anything else is not shown. */
const COVER_FILE = /^\/covers\/([\w-]+)-(?:512|1024)\.(?:webp|png)(\?v=\w+)?$/;

/**
 * The live vector of a cover (D314), at `/covers/<id>.svg`: `/covers/x-512.webp?v=1` names `x`. The
 * page colours it (cover.css) for its theme and style, so a switch needs no request. An empty string
 * is not a drawn cover.
 */
function liveSrc(src: string): string {
  const match = COVER_FILE.exec(src);
  const id = match?.[1];
  // encodeURIComponent changes nothing the pattern lets through; it marks the path safe for CodeQL.
  return id ? `/covers/${encodeURIComponent(id)}.svg${match?.[2] ?? ""}` : "";
}

/** One fetch for every place the player draws the same cover (the bar, the page, the flight, the glow). */
const loading = new Map<string, Promise<SVGSVGElement>>();

function loadCover(src: string): Promise<SVGSVGElement> {
  let held = loading.get(src);
  if (!held) {
    held = fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`cover ${response.status}`);
        return response.text();
      })
      .then((text) => {
        const root = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
        if (!(root instanceof SVGSVGElement)) throw new Error("not a cover");
        return root;
      });
    // A failure is not kept: the next mount tries again.
    held.catch(() => loading.delete(src));
    loading.set(src, held);
  }
  return held;
}

type Drawn = "pending" | "drawn" | "failed";

/** The vector placed in the frame; the key-coloured box shows until it is there. */
function LiveCover({ src, onState }: { src: string; onState?: (state: Drawn) => void }) {
  const slot = useRef<HTMLSpanElement>(null);
  // The callback is read when the fetch settles, so a new one each render does not restart it.
  const report = useRef(onState);
  useEffect(() => {
    report.current = onState;
  });
  useEffect(() => {
    const target = slot.current;
    if (!target || !src) return;
    let current = true;
    report.current?.("pending");
    loadCover(src).then(
      (root) => {
        if (!current) return;
        target.replaceChildren(document.importNode(root, true));
        report.current?.("drawn");
      },
      () => current && report.current?.("failed"),
    );
    return () => {
      current = false;
    };
  }, [src]);
  return <span ref={slot} className="player-cover-art" />;
}

interface PlayerCoverProps {
  cover: PlayerDigestData["cover"];
  /** Weekly deep dives carry a framing rule so they read as a different record at a glance. */
  weekly: boolean;
  /** "thumb" on the bar. "player" on the page and in flight, where it fills the box it is given. */
  size: "thumb" | "player";
}

/**
 * The cover as the player shows it: a decorative vector (the title sits beside it) on a box in the
 * palette's key color, so there is no empty flash while it loads. The player draws it three times
 * (on the bar, on the page, in flight). Below 64rem, where motion is allowed, its stylesheet shows
 * exactly one of them at a time; elsewhere the bar and the page each keep their own.
 */
export default function PlayerCover({ cover, weekly, size }: PlayerCoverProps) {
  const style = { "--cover-key": cover.key } as CSSProperties;
  const src = liveSrc(cover.src512);
  // Pending (no drawn path), missing or failed to load: the branded fallback (cover.css), never a
  // broken or empty box. A new cover path gets a new try.
  const [state, setState] = useState<{ src: string; drawn: Drawn }>({ src: "", drawn: "pending" });
  const fallback = !src || (state.src === src && state.drawn === "failed");
  return (
    <span
      className="player-cover-frame"
      data-size={size}
      data-weekly={weekly ? "" : undefined}
      data-fallback={fallback ? "" : undefined}
      style={style}
    >
      {src && <LiveCover src={src} onState={(drawn) => setState({ src, drawn })} />}
    </span>
  );
}

/**
 * The light the cover gives while it plays: the cover itself, blurred, behind the page's cover. It is
 * the cover's own colours by construction, in whatever style is shown. player.css fades it in while
 * playing and lets it breathe.
 */
export function PlayerCoverGlow({ cover }: { cover: PlayerDigestData["cover"] }) {
  const src = liveSrc(cover.src512);
  return (
    <span className="player-cover-glow" aria-hidden="true">
      <span className="player-cover-glow-light">{src && <LiveCover src={src} />}</span>
    </span>
  );
}

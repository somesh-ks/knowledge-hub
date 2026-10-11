/**
 * What the editor and the Topics and sources panel both draw: a site's tile, and a score. The markup
 * matches components/ScoreMeter.astro and SourceRow.astro, so topics.css styles both alike. Loaded
 * with the editor, never with the page.
 */
import { sourceInitial } from "../lib/sourceInitial";

/** What GET /api/source-preview returns. */
export interface SourcePreview {
  url: string;
  name: string;
  host: string;
  favicon_url: string | null;
  thumbnail_url: string | null;
  feed_url: string | null;
  kind: "feed" | "page";
  latest_at: string | null;
  items_30d: number | null;
  /** 0 to 3, one decimal. */
  score: number;
  score_label: string;
  /** Health, quality and trust, each 0 to 1. */
  score_parts?: { health: number; quality: number; trust: number } | null;
  reason: string;
}

/** The band a score out of 3 falls in: Good is 2.1 and up, Fair 1.5 to 2.1, Poor under 1.5, New has none. */
export function bandOf(score: number | null): "good" | "fair" | "poor" | "new" {
  if (score === null) return "new";
  return score >= 2.1 ? "good" : score >= 1.5 ? "fair" : "poor";
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A site's tile: the name's first letter, covered by the site's icon once that loads. */
export function iconNode(src: string | null, name: string): HTMLElement {
  const tile = element("span", "source-icon");
  tile.setAttribute("aria-hidden", "true");
  tile.append(element("span", "source-initial", sourceInitial(name)));
  // Only a secure address is drawn; anything else leaves the slot empty.
  if (src?.startsWith("https://")) {
    // Icons come through the site's own function, so the policy never allows another host.
    const image = new Image();
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.addEventListener("load", () => {
      if (image.naturalWidth > 0) image.dataset.loaded = "";
    });
    image.src = `/api/site-icon?url=${encodeURIComponent(src)}`;
    tile.append(image);
  }
  return tile;
}

/** Three pips filled to the score out of 3, the number and the label; a New source is only the label. */
export function scoreNode(score: number | null, label: string): HTMLElement {
  const wrap = element("span", "score");
  wrap.dataset.label = label;
  if (score !== null) {
    const pips = element("span", "pips");
    pips.setAttribute("aria-hidden", "true");
    pips.style.setProperty("--score", String(score));
    wrap.append(pips, element("span", "score-num", score.toFixed(1)));
  }
  wrap.append(element("span", "score-label", label));
  return wrap;
}

export { element };

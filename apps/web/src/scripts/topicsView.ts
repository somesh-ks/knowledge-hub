/**
 * What the editor and the Add source panel both draw: a site's icon, and a score. The markup matches
 * components/StarMeter.astro and SourceRow.astro, so topics.css styles both alike. Loaded with the
 * editor, never with the page.
 */

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
  score: number;
  score_label: string;
  reason: string;
}

/** The filter band a score falls in: Good is 4 and up, Fair 3 to 4, Poor under 3, New has none. */
export function bandOf(score: number | null): "good" | "fair" | "poor" | "new" {
  if (score === null) return "new";
  return score >= 4 ? "good" : score >= 3 ? "fair" : "poor";
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

/** The first letter or digit of a name, in capitals. */
export function letterOf(name: string): string {
  return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
}

/** A tile with the site's icon over the name's first letter; the icon shows only once it loads. */
export function iconNode(name: string, src: string | null): HTMLElement {
  const tile = element("span", "source-icon");
  tile.setAttribute("aria-hidden", "true");
  tile.append(element("span", "source-letter", letterOf(name)));
  // Only a secure address is drawn; anything else leaves the letter.
  if (src?.startsWith("https://")) {
    const image = new Image();
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.addEventListener("load", () => {
      if (image.naturalWidth > 0) image.dataset.loaded = "";
    });
    image.src = src;
    tile.append(image);
  }
  return tile;
}

/** Five stars, the number and the label; a New source is only the label. */
export function scoreNode(score: number | null, label: string): HTMLElement {
  const wrap = element("span", "score");
  wrap.dataset.label = label;
  if (score !== null) {
    const stars = element("span", "stars");
    stars.setAttribute("aria-hidden", "true");
    stars.style.setProperty("--score", String(score));
    wrap.append(stars, element("span", "score-num", score.toFixed(1)));
  }
  wrap.append(element("span", "score-label", label));
  return wrap;
}

export { element };

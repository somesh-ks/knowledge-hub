/**
 * What the editor and the Topics and sources panel both draw: a site's tile, and a score. The markup
 * matches components/ScoreMeter.astro and SourceRow.astro, so topics.css styles both alike. Loaded
 * with the editor, never with the page.
 */
import { ICON_PATHS, ICON_VIEW_BOX } from "../lib/icons";
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
  /** 0 to 5, one decimal. */
  score: number;
  score_label: string;
  /** Health, quality and trust, each 0 to 1. */
  score_parts?: { health: number; quality: number; trust: number } | null;
  reason: string;
}

/** The band a score out of 5 falls in: Good is 3.5 and up, Fair 2.5 to 3.5, Poor under 2.5, New has none. */
export function bandOf(score: number | null): "good" | "fair" | "poor" | "new" {
  if (score === null) return "new";
  return score >= 3.5 ? "good" : score >= 2.5 ? "fair" : "poor";
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

/** The star before a score (ScoreMeter.astro draws the same one on a built row). */
export function starNode(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon score-star");
  svg.setAttribute("viewBox", ICON_VIEW_BOX);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICON_PATHS.star);
  svg.append(path);
  return svg;
}

/** A score as one word, for the edit panel: a New source says it is not scored yet. */
export function scoreNode(label: string): HTMLElement {
  const wrap = element("span", "score", label === "New" ? "Not scored yet" : label);
  wrap.dataset.label = label;
  return wrap;
}

export { element };

/** Where a topic not built yet opens: one page the build makes for every such topic (D142). */
export const NEW_TOPIC_PAGE = "/settings/topics/new";

/**
 * A topic not built yet as a row of the Sources list, drawn as a built row is (it copies one), in its
 * place by name, linked to the page that shows it until the build gives it its own (D142). A row that
 * holds it already is returned instead, so a reload or a second call never lists it twice.
 */
export function topicRow(
  root: ParentNode,
  topic: { id: string; name: string; emoji: string },
  hint: string,
): HTMLAnchorElement | null {
  const index = root.querySelector<HTMLElement>(".topics-index");
  const rows = [...(index?.querySelectorAll<HTMLAnchorElement>("a.row-action[data-page]") ?? [])];
  const held = rows.find((row) => row.dataset.page === topic.id);
  if (held) return held;
  const model = rows[0];
  if (!index || !model) return null;
  const row = model.cloneNode(true) as HTMLAnchorElement;
  row.href = `${NEW_TOPIC_PAGE}?id=${encodeURIComponent(topic.id)}`;
  row.dataset.page = topic.id;
  row.dataset.members = topic.id;
  row.dataset.newTopic = "";
  delete row.dataset.never;
  row.hidden = false;
  const emoji = row.querySelector(".topic-emoji");
  if (emoji) emoji.textContent = topic.emoji;
  const label = row.querySelector(".settings-label");
  if (label) label.textContent = topic.name;
  const line = row.querySelector("[data-hint]");
  if (line) line.textContent = hint;
  // By name, as the build sorts them (byName in lib/topicPages.ts).
  const after = (other: HTMLElement): boolean => {
    const name = other.querySelector(".settings-label")?.textContent?.trim() ?? "";
    return (
      (name.localeCompare(topic.name, "en", { sensitivity: "base" }) ||
        name.localeCompare(topic.name, "en")) > 0
    );
  };
  index.insertBefore(row, rows.find(after) ?? null);
  return row;
}

import type { DigestEntry } from "./digests";
import type { EpisodeEntry } from "./episodes";

/**
 * The card a chat app draws for a pasted link (D153 stage 0): Open Graph and Twitter tags naming the
 * page's title, a line of its stories and its 1024 px PNG cover, which the build already makes.
 * BaseLayout writes the tags; checkBundle.ts fails a build whose briefing or episode page has none.
 */
export interface LinkCard {
  title: string;
  description: string;
  /** A path in the build, made absolute against the site by the layout. */
  image: string;
  imageAlt: string;
}

/** Previewers cut a description at about this many characters (D153). */
export const CARD_DESCRIPTION_MAX = 160;

/** The headlines in order, joined and cut at a word so the line ends whole. */
export function cardDescription(headlines: readonly string[]): string {
  const line = headlines.join("; ");
  if (line.length <= CARD_DESCRIPTION_MAX) return line;
  const cut = line.slice(0, CARD_DESCRIPTION_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[;,.:\s]+$/, "")}…`;
}

/** The 1024 cover as a PNG, keeping its ?v= so a regenerated card shows its new cover. */
const coverPng = (entry: { player: { cover: { src1024: string } } }) =>
  entry.player.cover.src1024.replace(".webp", ".png");

export function briefingCard(entry: DigestEntry): LinkCard {
  return {
    title: entry.player.title,
    description: cardDescription(entry.items.map((item) => item.headline)),
    image: coverPng(entry),
    imageAlt: `Cover of the Singularity briefing for ${entry.player.title}`,
  };
}

export function episodeCard(entry: EpisodeEntry): LinkCard {
  return {
    title: entry.episode.title,
    description: cardDescription(entry.episode.sources.map((source) => source.headline)),
    image: coverPng(entry),
    imageAlt: `Cover of the Singularity episode ${entry.episode.title}`,
  };
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', "#39": "'", lt: "<", gt: ">" };
const decode = (text: string) =>
  text.replace(/&(amp|quot|#39|lt|gt);/g, (match, name: string) => ENTITIES[name] ?? match);

const meta = (html: string, property: string): string | null => {
  const tag = html.match(new RegExp(`<meta[^>]+property="${property}"[^>]*>`))?.[0];
  const content = tag?.match(/content="([^"]*)"/)?.[1];
  return content === undefined ? null : decode(content);
};

/**
 * What is wrong with a built page's card: no title, a title that is not the page's own, or an image
 * the build does not hold. `exists` answers for a path in the build.
 */
export function linkCardProblems(html: string, exists: (path: string) => boolean): string[] {
  const title = meta(html, "og:title");
  const image = meta(html, "og:image");
  const pageTitle = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  const problems: string[] = [];
  if (!title) problems.push("no og:title");
  else if (!pageTitle.startsWith(title)) problems.push(`og:title "${title}" is not the page's`);
  if (!meta(html, "og:description")) problems.push("no og:description");
  if (!image) problems.push("no og:image");
  else if (!exists(new URL(image).pathname)) problems.push(`og:image ${image} is not in the build`);
  return problems;
}

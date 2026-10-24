import { type Digest, digestSections, longDate, parseDigestFile } from "@dispatch/core";
import { buildSpokenText, segmentSpokenText } from "@dispatch/engine/audio";
import { type Episode, parseEpisodeFile } from "../lib/episodeFile";
import { isWebUrl } from "../lib/safeUrl";
import type { DigestSource, EpisodeBundle } from "./narrate";
import { isEpisodeId } from "./narrate";

/**
 * What the public listen page shows of one briefing or episode (D153): its name and date, a short
 * description for the link card, the stories with their outlets and links, and the transcript. Built
 * from the digest or episode as the build holds it, so the page and narration read the same words.
 * Nothing here links into the app.
 */

/** og:description's limit, so a chat app's card never cuts it. */
export const LISTEN_DESCRIPTION_CHARS = 160;

export interface ListenStory {
  headline: string;
  source: string;
  /** The original, or null when the digest's address is not a web page. */
  url: string | null;
}

export interface ListenParagraph {
  /** Who says it in a two-host episode; null where one voice reads everything. */
  speaker: string | null;
  text: string;
}

export interface ListenView {
  id: string;
  kind: "briefing" | "episode";
  /** The `kind` the app's listen events carry: the digest's kind, "regular" for an episode. */
  listenKind: string;
  title: string;
  /** "Saturday 24 October". */
  dateLabel: string;
  weekly: boolean;
  description: string;
  stories: ListenStory[];
  transcript: ListenParagraph[];
}

/** Text cut at a word to `limit` characters, with an ellipsis when cut. */
export function clip(text: string, limit = LISTEN_DESCRIPTION_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

const story = (headline: string, source: string, url: string): ListenStory => ({
  headline,
  source,
  url: isWebUrl(url) ? url : null,
});

function describe(stories: readonly ListenStory[], noun: string): string {
  const count = `${stories.length} ${stories.length === 1 ? "story" : "stories"}`;
  return clip(`A ${noun} of ${count}: ${stories.map((each) => each.headline).join("; ")}`);
}

export function briefingView(digest: Digest): ListenView {
  const stories = digestSections(digest).flatMap((section) =>
    digest.items
      .filter((item) => item.section === section.id)
      .map((item) => story(item.headline, item.source, item.url)),
  );
  let transcript: ListenParagraph[] = [];
  try {
    transcript = segmentSpokenText(buildSpokenText(digest)).map((segment) => ({
      speaker: null,
      text: segment.text,
    }));
  } catch {
    // A digest that cannot be read aloud has no transcript; the page leaves the fold out.
  }
  const weekly = digest.kind === "weekly";
  return {
    id: digest.id,
    kind: "briefing",
    listenKind: digest.kind,
    title: longDate(digest.date),
    dateLabel: weekly ? "Weekly briefing" : "Daily briefing",
    weekly,
    description: describe(stories, weekly ? "weekly briefing" : "briefing"),
    stories,
    transcript,
  };
}

export function episodeView(episode: Episode): ListenView {
  const stories = episode.sources.map((source) =>
    story(source.headline, source.source, source.url),
  );
  const solo = episode.turns.every((turn) => turn.speaker === "a");
  const names = episode.request.host_names;
  return {
    id: episode.id,
    kind: "episode",
    listenKind: "regular",
    title: episode.title,
    dateLabel: longDate(episode.date),
    weekly: false,
    description: describe(stories, "episode"),
    stories,
    transcript: episode.turns.map((turn) => ({
      speaker: solo ? null : (names?.[turn.speaker] ?? null),
      text: turn.text,
    })),
  };
}

/** The view of an item from the files this build bundles, or null when there is no such item. */
export async function bundledListenView(
  itemId: string,
  sources: { digests: DigestSource; episodes: EpisodeBundle },
): Promise<ListenView | null> {
  try {
    if (isEpisodeId(itemId)) {
      const text = await sources.episodes.readEpisode(itemId);
      return text === null ? null : episodeView(parseEpisodeFile(text));
    }
    const text = await sources.digests.readDigest(itemId);
    return text === null ? null : briefingView(parseDigestFile(text));
  } catch {
    return null;
  }
}

import {
  type CoverSpec,
  Digest,
  type DigestItem,
  type DigestKind,
  displaySource,
  isBuiltinSection,
  SECTION_TITLES,
  VOICE_LIMITS,
  zonedDate,
} from "@dispatch/core";
import { assignSections } from "../score/selectItems.js";
import type { SelectedItem } from "../score/types.js";
import type { WrittenItem } from "../write/types.js";
import { digestWords, listenMinutes, readMinutes } from "./readTime.js";

export interface CoverPickInput {
  digestId: string;
  /** Calendar date of the digest, in the schedule's time zone. */
  date: string;
  kind: DigestKind;
  items: readonly DigestItem[];
}

/** Chooses cover art for a digest. Injected: the real picker lives with the cover package. */
export type CoverPicker = (input: CoverPickInput) => CoverSpec;

/** Returns an unused digest id for a date and kind. Injected so tests and the CLI share one rule. */
export type DigestIdAllocator = (input: { date: string; kind: DigestKind }) => string;

export interface BuildDigestInput {
  selected: readonly SelectedItem[];
  written: readonly WrittenItem[];
  window: { from: string; to: string };
  kind: DigestKind;
  now: Date;
  /** The schedule's time zone, which dates a new digest id. Defaults to Stockholm. */
  zone?: string;
  coverPicker: CoverPicker;
  allocateId: DigestIdAllocator;
  /** True only when every item passed the grounding check. Defaults to false. */
  verified?: boolean;
  /** Audio is added later by `dispatch audio`. */
  audio: null;
  /** Display names by source id; the id itself is shown when a name is unknown. */
  sourceNames?: Readonly<Record<string, string>>;
  /**
   * Ids of sources whose items link to other publishers. Their items, like those of aggregator
   * source types, are credited to the publisher of the URL instead of the registry name.
   */
  linkSources?: ReadonlySet<string>;
  /**
   * Titles of custom sections by id, from config/topics.json. Copied into the digest as
   * `section_titles` so the briefing keeps its headings if the topic is later renamed or removed.
   */
  sectionTitles?: Readonly<Record<string, string>>;
}

/**
 * Assemble the digest from selected items and their written text. Items without written text
 * are skipped, and sections are assigned again over the survivors so the three Top picks are
 * always the best three that remain. Reading and listening times come from the final text.
 */
export function buildDigest(input: BuildDigestInput): Digest {
  const writtenById = new Map(input.written.map((w) => [w.id, w]));
  const survivors = input.selected.filter((s) => writtenById.has(s.item.id));
  if (survivors.length < VOICE_LIMITS.items.floor) {
    throw new Error(
      `Cannot build a digest from ${survivors.length} written items; the minimum is ${VOICE_LIMITS.items.floor}.`,
    );
  }

  const items: DigestItem[] = assignSections(survivors).map((sel) => {
    const text = writtenById.get(sel.item.id) as WrittenItem;
    const item: DigestItem = {
      id: sel.item.id,
      section: sel.section,
      category: sel.category,
      source_type: sel.item.source_type,
      headline: text.headline,
      url: sel.item.canonical_url,
      source: displaySource({
        url: sel.item.canonical_url,
        sourceType: sel.item.source_type,
        sourceName: input.sourceNames?.[sel.item.source_id] ?? sel.item.source_id,
        linkSource: input.linkSources?.has(sel.item.source_id) ?? false,
      }),
      summary: text.summary,
      score: sel.score,
    };
    if (text.spoken) item.spoken = text.spoken;
    if (text.chapter) item.chapter = text.chapter;
    // Only an agent session still supplies a why line; the frontmatter carries none otherwise.
    if (text.why) item.why = text.why;
    if (sel.item.author) item.author = sel.item.author;
    if (sel.item.published_at) item.published_at = sel.item.published_at;
    return item;
  });

  // Sections in reading order. The snapshot is written only when a custom section is in use, so a
  // digest without one is byte for byte what it was before custom sections existed.
  const used: string[] = [];
  for (const item of items) if (!used.includes(item.section)) used.push(item.section);
  const sectionTitles = used.some((section) => !isBuiltinSection(section))
    ? Object.fromEntries(
        used.map((section) => [
          section,
          isBuiltinSection(section)
            ? SECTION_TITLES[section]
            : (input.sectionTitles?.[section] ?? section),
        ]),
      )
    : undefined;

  const id = input.allocateId({ date: zonedDate(input.now, input.zone), kind: input.kind });
  // The date is part of the id, so a pool fetched before midnight and rendered after it still agrees.
  const date = id.slice(0, 10);
  const words = digestWords(items);
  return Digest.parse({
    id,
    date,
    kind: input.kind,
    verified: input.verified ?? false,
    generated_at: input.now.toISOString(),
    window: input.window,
    read_minutes: readMinutes(words),
    listen_minutes: listenMinutes(words),
    audio: input.audio,
    cover: input.coverPicker({ digestId: id, date, kind: input.kind, items }),
    ...(sectionTitles ? { section_titles: sectionTitles } : {}),
    items,
  });
}

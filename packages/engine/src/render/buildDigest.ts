import {
  type CoverSpec,
  Digest,
  type DigestItem,
  type DigestKind,
  stockholmDate,
  VOICE_LIMITS,
} from "@dispatch/core";
import { assignSections } from "../score/selectItems.js";
import type { SelectedItem } from "../score/types.js";
import type { WrittenItem } from "../write/types.js";
import { digestWords, listenMinutes, readMinutes } from "./readTime.js";

export interface CoverPickInput {
  digestId: string;
  /** Stockholm calendar date of the digest. */
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
  coverPicker: CoverPicker;
  allocateId: DigestIdAllocator;
  /** True only when every item passed the grounding check. Defaults to false. */
  verified?: boolean;
  /** Audio is added later by `dispatch audio`. */
  audio: null;
  /** Display names by source id; the id itself is shown when a name is unknown. */
  sourceNames?: Readonly<Record<string, string>>;
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
      source: input.sourceNames?.[sel.item.source_id] ?? sel.item.source_id,
      summary: text.summary,
      why: text.why,
      score: sel.score,
    };
    if (sel.item.author) item.author = sel.item.author;
    if (sel.item.published_at) item.published_at = sel.item.published_at;
    return item;
  });

  const date = stockholmDate(input.now);
  const id = input.allocateId({ date, kind: input.kind });
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
    items,
  });
}

import {
  categoryIsOff,
  type Digest,
  homeSectionFor,
  type Item,
  type TopicsFile,
  topicSectionTitles,
} from "@singularity/core";
import type { Selection } from "../curate/selectionFile.js";
import { buildDigest, type CoverPicker, type DigestIdAllocator } from "../render/buildDigest.js";
import type { SectionPlan } from "../score/sectionPlan.js";
import type { SelectedItem } from "../score/types.js";
import { writtenText } from "../write/text.js";
import { StageFailure } from "./errors.js";

export interface DigestFromSelectionInput {
  selection: Selection;
  pool: readonly Item[];
  sourceNames: Readonly<Record<string, string>>;
  linkSources?: ReadonlySet<string>;
  now: Date;
  coverPicker: CoverPicker;
  allocateId: DigestIdAllocator;
  verified: boolean;
  /** config/topics.json, to place a custom topic's stories. Built-in categories need none. */
  topics?: TopicsFile | null | undefined;
  /** The kind's structure (D170), so the digest reads its sections in the owner's order. */
  plan?: SectionPlan;
  /** The regenerations this digest carries when it replaces another (D212). */
  regenerations?: number;
  /** The schedule's narration voice for this kind, for the audio job that cannot read it (D296). */
  voiceId?: string | null | undefined;
}

/**
 * The digest a selection renders to: items rebuilt from the pool, sections and Top picks assigned,
 * reading times computed. The same function backs the validate stage's preview and the commit
 * stage's file, so what validation checked is what gets written.
 */
export function digestFromSelection(input: DigestFromSelectionInput): Digest {
  const byId = new Map(input.pool.map((item) => [item.id, item]));
  const selected: SelectedItem[] = input.selection.items.map((entry) => {
    const item = byId.get(entry.id);
    if (!item) throw new StageFailure(`The selection names ${entry.id}, which is not in the pool.`);
    const home = homeSectionFor(input.topics, entry.category, item.source_type);
    if (home === null || categoryIsOff(input.topics, entry.category)) {
      throw new StageFailure(
        `The category ${entry.category} of ${entry.id} never publishes or is no longer a topic.`,
      );
    }
    return { item, category: entry.category, home, section: home, score: entry.score };
  });
  return buildDigest({
    selected,
    written: input.selection.items.map((entry) => ({ id: entry.id, ...writtenText(entry) })),
    window: input.selection.window,
    kind: input.selection.kind,
    now: input.now,
    coverPicker: input.coverPicker,
    allocateId: input.allocateId,
    verified: input.verified,
    audio: null,
    sourceNames: input.sourceNames,
    ...(input.linkSources ? { linkSources: input.linkSources } : {}),
    ...(input.topics ? { sectionTitles: topicSectionTitles(input.topics) } : {}),
    ...(input.plan ? { plan: input.plan } : {}),
    ...(input.regenerations ? { regenerations: input.regenerations } : {}),
    ...(input.voiceId ? { voiceId: input.voiceId } : {}),
  });
}

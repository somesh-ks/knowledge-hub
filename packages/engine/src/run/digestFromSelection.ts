import { type Digest, homeSection, type Item } from "@dispatch/core";
import type { Selection } from "../curate/selectionFile.js";
import { buildDigest, type CoverPicker, type DigestIdAllocator } from "../render/buildDigest.js";
import type { SelectedItem } from "../score/types.js";
import { writtenText } from "../write/text.js";
import { StageFailure } from "./errors.js";

export interface DigestFromSelectionInput {
  selection: Selection;
  pool: readonly Item[];
  sourceNames: Readonly<Record<string, string>>;
  now: Date;
  coverPicker: CoverPicker;
  allocateId: DigestIdAllocator;
  verified: boolean;
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
    const home = homeSection(entry.category, item.source_type);
    if (home === null) {
      throw new StageFailure(`The category ${entry.category} of ${entry.id} never publishes.`);
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
  });
}

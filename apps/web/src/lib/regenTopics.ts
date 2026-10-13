import type { ManageSource, ManageTopic } from "./manage";
import { topicLayout } from "./topicPages";

/** One topic chip in a Regenerate dialog: the ids it stands for, ticked together. */
export interface RegenChip {
  value: string;
  label: string;
  ids: readonly string[];
  /** The sections the topics publish to, which a briefing's items name; absent when ids are sections. */
  sections?: readonly string[];
}

/**
 * The chips a briefing's Regenerate offers: the schedule's own list (settings/[profile].astro), the
 * owner's three topics, their own and the general news topics.
 */
export function briefingChips(
  topics: readonly ManageTopic[],
  sources: readonly ManageSource[],
): RegenChip[] {
  const layout = topicLayout(topics, sources);
  return [
    ...layout.groups.map((group) => ({
      value: group.id,
      label: group.name,
      ids: group.members.map((member) => member.id),
      sections: group.members.map((member) => member.section_id),
    })),
    ...layout.own.map((topic) => ({
      value: topic.id,
      label: topic.name,
      ids: [topic.id],
      sections: [topic.section_id],
    })),
    ...layout.general.map((topic) => ({
      value: topic.id,
      label: topic.name,
      ids: [topic.id],
      sections: [topic.section_id],
    })),
  ];
}

/** A chip is ticked when the original covers any topic or section it stands for. */
export function isChipOn(
  chip: Pick<RegenChip, "ids" | "sections">,
  original: readonly string[],
): boolean {
  return [...chip.ids, ...(chip.sections ?? [])].some((id) => original.includes(id));
}

/** Every id the ticked chips stand for, once each: what a regeneration sends. */
export function idsOfChips(chips: readonly Pick<RegenChip, "ids">[]): string[] {
  return [...new Set(chips.flatMap((chip) => chip.ids))];
}

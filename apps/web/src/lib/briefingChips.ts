import type { ManageSource, ManageTopic } from "./manage";
import type { RegenChip } from "./regenTopics";
import { topicLayout } from "./topicPages";

/**
 * The chips a briefing's Regenerate offers: the schedule's own list (settings/[profile].astro), the
 * owner's four topics, their own and the general news topics.
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

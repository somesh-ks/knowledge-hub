import { GENERAL_TOPICS, groupHomeId, TOPIC_GROUPS, topicGroupOf } from "@dispatch/core";
import type { ManageSource, ManageTopic } from "./manage";
import { sourcesSummary } from "./settingsSummary";
import type { TopicWords } from "./sourceCatalog";

/**
 * What the Topics pages are built from: each topic's sources, best first, the line each topic's row says on the Topics page.
 */

/** The page of the sources that feed no known topic. Reserved: no topic may take this id. */
export const OTHER_ID = "other";

/** By name, as a person reads a list: letters before case, so "audio" and "Audio" sit together. */
export function byName(a: { name: string }, b: { name: string }): number {
  return (
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
    a.name.localeCompare(b.name, "en")
  );
}

/** Best first: a score before none, then the name. */
export function byScore(a: ManageSource, b: ManageSource): number {
  return (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, "en");
}

/** Each topic's sources, best first, and under OTHER_ID the ones whose topic is unknown or unset. */
export function sourcesByTopic(
  topics: readonly ManageTopic[],
  sources: readonly ManageSource[],
): Map<string, ManageSource[]> {
  const known = new Set(topics.map((topic) => topic.id));
  const groups = new Map<string, ManageSource[]>([[OTHER_ID, []]]);
  for (const topic of topics) groups.set(topic.id, []);
  for (const source of sources) {
    const id = source.topic_id && known.has(source.topic_id) ? source.topic_id : OTHER_ID;
    groups.get(id)?.push(source);
  }
  for (const list of groups.values()) list.sort(byScore);
  return groups;
}

export { plural } from "./settingsSummary";

/** The general news topics in the order the app lists them (GENERAL_TOPICS), not by name. */
export function generalOf(topics: readonly ManageTopic[]): ManageTopic[] {
  const order = GENERAL_TOPICS.map((topic) => topic.id as string);
  const rank = (id: string): number => order.indexOf(id);
  return topics
    .filter((topic) => topic.origin === "general")
    .sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * What a topic's row says about its sources (sourcesSummary): "2 of 3 sources on". One of the
 * owner's four topics (a group, no topic of its own) passes null.
 */
export function topicSummary(topic: ManageTopic | null, total: number, on = total): string {
  return sourcesSummary({
    total,
    on,
    never: topic?.never_publish === true,
  });
}

/** One of the owner's four topics (core TOPIC_GROUPS) as its page shows it. */
export interface GroupPage {
  id: string;
  name: string;
  note: string;
  /** Where a source added from the page is filed: the group's home topic, or its first member. */
  home: string;
  /** The judge's topics it gathers. */
  members: ManageTopic[];
}

/** The Topics and sources pages and where every source shows (D69). */
export interface TopicLayout {
  /** Design, AI, Technology and Software Engineering, in that order, each with at least one member. */
  groups: GroupPage[];
  /** The owner's own topics that publish to a section of their own, by name. */
  own: ManageTopic[];
  /** The general news topics, in the app's order. */
  general: ManageTopic[];
  /** Each page's sources, best first; OTHER_ID holds the ones no page shows. */
  sources: Map<string, ManageSource[]>;
}

/**
 * Lay the topics out as a person sees them: four topics of the owner's (the judge's finer topics
 * gathered by section), the owner's own topics apart from those, the general news topics, and
 * Other for every source the pages do not show: no topic, a topic that never publishes, or one the
 * app no longer lists (Trending).
 */
export function topicLayout(
  topics: readonly ManageTopic[],
  sources: readonly ManageSource[],
): TopicLayout {
  const pageOf = new Map<string, string>();
  const groups: GroupPage[] = [];
  for (const group of TOPIC_GROUPS) {
    const members = topics.filter((topic) => topicGroupOf(topic)?.id === group.id);
    if (members.length === 0) continue;
    for (const member of members) pageOf.set(member.id, group.id);
    groups.push({
      id: group.id,
      name: group.name,
      note: group.note,
      home: groupHomeId(group, topics),
      members,
    });
  }
  const own = topics
    .filter((topic) => topic.origin === "custom" && !topic.never_publish && !pageOf.has(topic.id))
    .sort(byName);
  const general = generalOf(topics);
  for (const topic of [...own, ...general]) pageOf.set(topic.id, topic.id);

  const pages = new Map<string, ManageSource[]>([[OTHER_ID, []]]);
  for (const id of new Set(pageOf.values())) pages.set(id, []);
  for (const source of sources) {
    const page = (source.topic_id && pageOf.get(source.topic_id)) || OTHER_ID;
    pages.get(page)?.push(source);
  }
  for (const list of pages.values()) list.sort(byScore);
  return { groups, own, general, sources: pages };
}

/** The topics a source can be filed under, by name, as the panel offers them. */
export function topicChoicesOf(layout: TopicLayout): { id: string; name: string }[] {
  return [
    ...layout.groups.map((group) => ({ id: group.home, name: group.name })),
    ...layout.own.map(({ id, name }) => ({ id, name })),
    ...layout.general.map(({ id, name }) => ({ id, name })),
  ].sort(byName);
}

/**
 * What a page's sources are suggested by (suggestSources): the words its topic goes by. One of the
 * owner's four is its name and the names and keywords of the judge's topics it gathers. A general
 * topic is its name and keywords alone: its description is the judge's fit question, written for a
 * model and not as words to look for. The owner's own topic is its name, description and keywords.
 * Other has no subject, so nothing is suggested for it.
 */
export function suggestionWords(page: {
  group: GroupPage | null;
  topic: ManageTopic | null;
}): TopicWords | null {
  const { group, topic } = page;
  if (group) {
    return {
      id: group.id,
      name: group.name,
      keywords: group.members.flatMap((member) => [member.name, ...member.keywords]),
    };
  }
  if (!topic) return null;
  return {
    id: topic.id,
    name: topic.name,
    keywords: topic.keywords,
    ...(topic.origin === "general" ? {} : { description: topic.description }),
  };
}

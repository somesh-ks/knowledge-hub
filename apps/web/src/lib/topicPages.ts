import type { ManageSource, ManageTopic } from "./manage";

/**
 * What the Topics pages are built from: each topic's sources, best first, a stored weight at the
 * slider's step, and the line each topic's row says on the Topics page.
 */

/** The page of the sources that feed no known topic. Reserved: no topic may take this id. */
export const OTHER_ID = "other";

/** The slider moves in twentieths; a stored weight is shown at the nearest one. */
export const WEIGHT_STEP = 0.05;

export function snap(weight: number): number {
  return Math.round(weight / WEIGHT_STEP) * WEIGHT_STEP;
}

export function percent(weight: number): string {
  return `${Math.round(snap(weight) * 100)}%`;
}

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

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** What a topic's row says: "Weight 95%, 1 source", "Off, 2 sources" or "Never in a briefing". */
export function topicSummary(topic: ManageTopic, sourceCount: number): string {
  if (topic.never_publish) return "Never in a briefing";
  const sources = plural(sourceCount, "source");
  return topic.enabled ? `Weight ${percent(topic.weight)}, ${sources}` : `Off, ${sources}`;
}

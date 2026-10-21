/**
 * Which Nebius models the model select offers. The Top models group is a curated list checked
 * against the live one (topModels); the ranking (shortlist) stands in when none of the curated ids
 * is left. The ranking is pure over the ids the API sends: larger chat models of the newest
 * generations first, with the models that cannot write a script (embedding, vision, guard, base,
 * coder) left out. It imports nothing, so the page script can use it without growing the
 * first-load bundle.
 */

export interface RankEntry {
  id: string;
  context_length: number | null;
}

/** Never offered as a recommendation: they cannot write a podcast script well, or at all. */
const NOT_CHAT =
  /embed|bge-|rerank|guard|safety|moderation|\bvl\b|vision|llava|pixtral|ocr|whisper|tts|code|[-_]base\b/i;

/** Families the owner never wants offered, however they rank (Kimi, 2026-10-21). */
export const EXCLUDED_MODELS = /kimi/i;

/** Parameter counts (billions) for families whose ids do not carry one. */
const KNOWN_SIZE: ReadonlyArray<readonly [RegExp, number]> = [
  [/deepseek-(?:v3|r1)/i, 671],
  [/glm-4\.[5-9]/i, 355],
];

/** Generations that are current; a model from an older one is still offered, further down. */
const NEWEST: readonly RegExp[] = [
  /deepseek-v3\.[2-9]/i,
  /qwen3/i,
  /gpt-oss/i,
  /glm-4\.[5-9]/i,
  /llama-?3\.3/i,
  /nemotron/i,
];

function billions(id: string): number {
  for (const [pattern, size] of KNOWN_SIZE) if (pattern.test(id)) return size;
  // "235B-A22B" is a 235B model that runs 22B at a time: the first figure is the size.
  const match = /(?:^|[^a-z0-9])(\d+(?:\.\d+)?)b(?![a-z])/i.exec(id.replace(/_/g, "."));
  return match ? Number(match[1]) : 0;
}

/** Whether a model can be recommended at all. */
export function isRecommendable(id: string): boolean {
  return !NOT_CHAT.test(id) && !EXCLUDED_MODELS.test(id);
}

/** Higher is better. Size counts on a log scale, so 235B is not twice as good as 120B. */
export function scoreModel(entry: RankEntry): number {
  const size = billions(entry.id);
  let score = size > 0 ? Math.log2(size) * 10 : 20;
  if (NEWEST.some((pattern) => pattern.test(entry.id))) score += 25;
  if (/instruct|[-_]it\b|chat/i.test(entry.id)) score += 6;
  if (/r1|reason|think/i.test(entry.id)) score += 3;
  if (/fast|flash|mini|lite|tiny|small/i.test(entry.id)) score -= 8;
  if ((entry.context_length ?? 0) >= 128 * 1024) score += 3;
  return score;
}

/**
 * The ids to recommend, best first: at most `max`, at most two from one vendor so the list is a
 * choice and not one family. Ties break on the id so the order never changes between loads.
 */
export function shortlist(entries: readonly RankEntry[], max = 5): string[] {
  const ranked = entries
    .filter((entry) => isRecommendable(entry.id))
    .map((entry) => ({ id: entry.id, score: scoreModel(entry) }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const perVendor = new Map<string, number>();
  const picked: string[] = [];
  for (const { id } of ranked) {
    const vendor = id.includes("/") ? id.slice(0, id.indexOf("/")).toLowerCase() : "";
    const used = perVendor.get(vendor) ?? 0;
    if (used >= 2) continue;
    perVendor.set(vendor, used + 1);
    picked.push(id);
    if (picked.length === max) break;
  }
  return picked;
}

/**
 * The ids of the Top models group, in the curated order. A live list decides which are still
 * served: a curated id it lacks has been retired and drops out, and when none is left the
 * shortlist stands in, so the group is never empty while Nebius lists models. Without a live list
 * (null) nothing says an id has gone, so every curated id is offered and a pick never needs a
 * typed id.
 */
export function topModels(live: readonly RankEntry[] | null, curated: readonly string[]): string[] {
  if (live === null) return [...curated];
  const served = new Set(live.map((entry) => entry.id));
  const kept = curated.filter((id) => served.has(id) && !EXCLUDED_MODELS.test(id));
  return kept.length > 0 ? kept : shortlist(live);
}

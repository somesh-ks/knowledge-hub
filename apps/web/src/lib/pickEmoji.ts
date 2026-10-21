/**
 * Asks the site for a new topic's emoji (GET /api/topic-emoji, where Jev chooses). Gives up after
 * `ms`: with no answer the topic is saved without one, and the page shows the name's fixed fallback
 * (core topicEmoji), so nothing waits on Jev for long.
 */
export async function pickEmoji(
  name: string,
  description: string,
  ms = 4500,
): Promise<string | undefined> {
  try {
    const query = new URLSearchParams({ name, description });
    const response = await fetch(`/api/topic-emoji?${query}`, { signal: AbortSignal.timeout(ms) });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { emoji?: unknown };
    return typeof body.emoji === "string" && body.emoji !== "" ? body.emoji : undefined;
  } catch {
    return undefined;
  }
}

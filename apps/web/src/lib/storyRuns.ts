/**
 * Where each story of an episode or briefing runs, from where each one first starts: a story lasts
 * until the next one begins, and the last lasts to the end. Whatever is said between two stories
 * (a link, a reaction, the sign-off) belongs to the story before it, as the transcript reads it
 * (storyTranscript.ts) and as a briefing's own timeline ends an item where the next starts, so
 * the lengths add up to the recording. Lengths taken from a story's last tagged turn instead left
 * out every untagged turn after it, and a story tagged on one turn showed that turn's length alone.
 */
export function storyRuns(
  firstStartMs: ReadonlyMap<string, number>,
  totalMs: number,
): Map<string, { start_ms: number; end_ms: number }> {
  const ordered = [...firstStartMs].sort((a, b) => a[1] - b[1]);
  const runs = new Map<string, { start_ms: number; end_ms: number }>();
  ordered.forEach(([id, start], index) => {
    const next = ordered[index + 1]?.[1] ?? totalMs;
    runs.set(id, { start_ms: start, end_ms: Math.max(start, next) });
  });
  return runs;
}

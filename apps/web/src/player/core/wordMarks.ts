import { parseSegmentMarks, type SegmentWordMark } from "../../lib/segmentMarks";

/**
 * A narrated turn's word marks, from GET /api/narrate-marks. Loaded only when the transcript is
 * open, for the turn being spoken and the next, so this module is imported on demand and the
 * player's first load does not carry it.
 *
 * Asked for once per segment for the life of the page, whatever the answer. Anything but marks (no
 * file yet, a turn narrated before marks were kept, a static build that answers with a page, a
 * network failure) is null, and the transcript keeps its estimate.
 */
const asked = new Map<string, Promise<SegmentWordMark[] | null>>();

async function fetchMarks(digest: string, segment: string): Promise<SegmentWordMark[] | null> {
  try {
    const query = new URLSearchParams({ digest, segment });
    const response = await fetch(`/api/narrate-marks?${query}`);
    if (!response.ok) return null;
    return parseSegmentMarks(await response.json())?.words ?? null;
  } catch {
    return null;
  }
}

export function loadWordMarks(digest: string, segment: string): Promise<SegmentWordMark[] | null> {
  const key = `${digest}/${segment}`;
  let marks = asked.get(key);
  if (!marks) {
    marks = fetchMarks(digest, segment);
    asked.set(key, marks);
  }
  return marks;
}

import type { Digest } from "@dispatch/core";
import { AudioTimeline } from "@dispatch/core";
import type { SpeechMark } from "./speechify.js";
import type { SpokenText } from "./spokenText.js";

export interface TimelineInput {
  digest: Pick<Digest, "id">;
  spoken: SpokenText;
  marks: readonly SpeechMark[];
  durationMs: number;
  voice: string;
  model: string;
}

/** Marks cannot place every item, so the caller should fall back to the estimated timeline. */
export class TimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineError";
  }
}

interface AlignedMark {
  /** Character offset of the word in the spoken text. */
  start: number;
  startMs: number;
}

/**
 * Word marks with trustworthy offsets, sorted by position. Speechify's offsets index the input
 * text, so `value` should equal the slice. When it does not (whitespace normalized upstream, say)
 * the mark is re-anchored by searching for its text after the previous word, and dropped if absent.
 */
export function alignMarks(text: string, marks: readonly SpeechMark[]): AlignedMark[] {
  const aligned: AlignedMark[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.type !== undefined && mark.type !== "word") continue;
    if (mark.value.length === 0) continue;
    let start = mark.start;
    if (text.slice(mark.start, mark.end) !== mark.value) {
      const found = text.indexOf(mark.value, cursor);
      if (found < 0) continue;
      start = found;
    }
    cursor = Math.max(cursor, start + mark.value.length);
    aligned.push({ start, startMs: Math.round(mark.start_time) });
  }
  return aligned.sort((a, b) => a.start - b.start);
}

/** First mark at or after `offset`, by binary search over marks sorted by offset. */
function firstMarkAtOrAfter(
  marks: readonly AlignedMark[],
  offset: number,
): AlignedMark | undefined {
  let low = 0;
  let high = marks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const mark = marks[mid];
    if (mark !== undefined && mark.start >= offset) high = mid;
    else low = mid + 1;
  }
  return marks[low];
}

function assemble(
  kind: AudioTimeline["timeline"],
  input: TimelineInput,
  itemStarts: number[],
  sectionStartMs: number[],
  duration: number,
): AudioTimeline {
  const { spoken } = input;
  const result = AudioTimeline.safeParse({
    digest: input.digest.id,
    voice: input.voice,
    model: input.model,
    timeline: kind,
    duration_ms: duration,
    text_chars: spoken.text.length,
    items: spoken.ranges.map((range, index) => ({
      id: range.id,
      section: range.section,
      start_ms: itemStarts[index] ?? 0,
      end_ms: index + 1 < itemStarts.length ? (itemStarts[index + 1] ?? duration) : duration,
    })),
    sections: spoken.sectionStarts.map((section, index) => ({
      slug: section.slug,
      start_ms: sectionStartMs[index] ?? 0,
    })),
  });
  if (!result.success)
    throw new TimelineError(`Timeline failed validation: ${result.error.message}`);
  return result.data;
}

/**
 * Timeline from word marks. An item starts at the first mark at or after its range start (marks may
 * begin after leading silence and may skip characters), and ends where the next item starts; the
 * last item ends at the audio duration. Section starts follow the same rule from the section title.
 */
export function buildTimeline(input: TimelineInput): AudioTimeline {
  const { spoken } = input;
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    throw new TimelineError("Audio duration must be positive");
  }
  const duration = Math.round(input.durationMs);
  const marks = alignMarks(spoken.text, input.marks);
  if (marks.length === 0) throw new TimelineError("No usable word marks");

  let previous = 0;
  const itemStarts = spoken.ranges.map((range) => {
    const mark = firstMarkAtOrAfter(marks, range.start);
    // A mark past the item's own text belongs to a later item: this item's words were all dropped.
    if (!mark || mark.start >= range.end) {
      throw new TimelineError(`No word mark inside item ${range.id}`);
    }
    previous = Math.max(previous, mark.startMs);
    return previous;
  });
  const lastStart = itemStarts.at(-1);
  if (lastStart !== undefined && lastStart >= duration) {
    throw new TimelineError("Word marks run past the audio duration");
  }

  let previousSection = 0;
  const sectionStartMs = spoken.sectionStarts.map((section) => {
    const firstItemIndex = spoken.ranges.findIndex((range) => range.section === section.slug);
    const firstItemStart = itemStarts[firstItemIndex] ?? duration;
    const mark = firstMarkAtOrAfter(marks, section.start);
    // The title's own words are marked, but never let a missing mark push the section past its items.
    const start = Math.min(mark?.startMs ?? firstItemStart, firstItemStart);
    previousSection = Math.max(previousSection, start);
    return previousSection;
  });

  return assemble("marks", input, itemStarts, sectionStartMs, duration);
}

/**
 * Timeline from character share of the duration, for when marks are unavailable. Coarse: it assumes
 * a constant speaking rate, so starts can be off by several seconds across a long digest.
 */
export function estimateTimeline(input: Omit<TimelineInput, "marks">): AudioTimeline {
  const { spoken } = input;
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    throw new TimelineError("Audio duration must be positive");
  }
  const duration = Math.round(input.durationMs);
  const share = (offset: number): number =>
    Math.min(duration - 1, Math.round((offset / spoken.text.length) * duration));
  return assemble(
    "estimated",
    { ...input, marks: [] },
    spoken.ranges.map((range) => share(range.start)),
    spoken.sectionStarts.map((section) => share(section.start)),
    duration,
  );
}

export interface ResolvedTimeline {
  timeline: AudioTimeline;
  /** Why the estimate was used instead of marks, when it was. */
  degradedReason?: string;
}

/** Marks when they place every item, otherwise the estimate with the reason recorded. */
export function resolveTimeline(input: TimelineInput): ResolvedTimeline {
  if (input.marks.length === 0) {
    return {
      timeline: estimateTimeline(input),
      degradedReason: "Speechify returned no word marks",
    };
  }
  try {
    return { timeline: buildTimeline(input) };
  } catch (error) {
    if (error instanceof TimelineError) {
      return { timeline: estimateTimeline(input), degradedReason: error.message };
    }
    throw error;
  }
}

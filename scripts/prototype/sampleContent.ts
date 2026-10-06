/**
 * Sample content for the UI prototype. Everything here is invented: names, projects, studies and
 * links are not real. It follows config/voice.md: headline at most 12 words, summary at most 35
 * words in two sentences, why at most 18 words in one sentence, no em dashes, no exclamation marks.
 * A test checks those limits.
 */

export type SectionSlug = "top" | "ui-craft" | "ai" | "research" | "launches" | "watch";

export const SECTION_TITLES: Record<SectionSlug, string> = {
  top: "Top picks",
  "ui-craft": "Interaction craft",
  ai: "AI models and products",
  research: "Research",
  launches: "Launches",
  watch: "Watch and listen",
};

export interface SampleItem {
  id: string;
  section: SectionSlug;
  headline: string;
  source: string;
  author: string;
  summary: string;
  why: string;
}

export const ITEMS: readonly SampleItem[] = [
  {
    id: "3f2a9c1e5b07",
    section: "top",
    headline:
      "Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity",
    source: "Springlet Blog",
    author: "Mara Lindqvist",
    summary:
      "Every transition is now a spring with a live target, so a grabbed drawer continues from its current velocity instead of restarting. A new gesture layer feeds a flick's momentum straight into the settle.",
    why: "Copy the retargeting pattern for drawers and toasts.",
  },
  {
    id: "a81d40c7e2b9",
    section: "top",
    headline: "A dither shader that stays sharp at any pixel density",
    source: "Fathom Notes",
    author: "Jonas Ek",
    summary:
      "A fragment shader dithers in screen space but samples in object space, so gradients keep their texture when layouts scale. The code is about forty lines with no dependencies.",
    why: "A copyable way to add texture to flat interfaces without shipping an image.",
  },
  {
    id: "5c0e7b93a1d4",
    section: "top",
    headline:
      "Four measures for agent interfaces: first useful signal, correction cost, interruptions, recovery",
    source: "Parley Journal",
    author: "Ines Roca",
    summary:
      "The post proposes time to first useful signal, correction cost, interruption rate and recovery as measurable qualities. It reports early numbers from two internal products.",
    why: "Each measure can be logged from a prototype this week.",
  },
  {
    id: "b27f6d18c409",
    section: "ui-craft",
    headline: "Hairline 0.9 adds container-query tokens for spacing and radius",
    source: "Hairline releases",
    author: "Hairline maintainers",
    summary:
      "Spacing and radius tokens now respond to the container they sit in, not the viewport. The migration guide covers three breaking renames.",
    why: "Components in resizable panels get tokens that match their real width.",
  },
  {
    id: "09e4a5d37f12",
    section: "ui-craft",
    headline: "The safe triangle, rebuilt with pointer events",
    source: "Interface Details",
    author: "Tomás Rivera",
    summary:
      "A submenu hover tolerates diagonal pointer movement by tracking a triangle between the cursor and the submenu corners. It includes a touch fallback and a keyboard path.",
    why: "A concrete fix for a flaw that nearly every nested menu still has.",
  },
  {
    id: "d6a3182be5c0",
    section: "ui-craft",
    headline: "Scroll-driven animation without layout thrash",
    source: "Frontier CSS",
    author: "Linnea Berg",
    summary:
      "Drives transforms from scroll timelines on the compositor and shows where the technique still falls back to script. Benchmarks come from mid-range Android phones.",
    why: "Numbers for deciding when native scroll timelines are safe to ship.",
  },
  {
    id: "7e91c4f0a8b3",
    section: "ai",
    headline: "Northlight releases an open-weight model tuned for tool use",
    source: "Northlight Labs",
    author: "Research team",
    summary:
      "The 32 billion parameter model trains on agent traces that recover from failed tool calls. Weights and an evaluation harness are public.",
    why: "Better recovery means fewer confirmation prompts in an agent interface.",
  },
  {
    id: "c4b8e2a97d65",
    section: "ai",
    headline: "Designing the pause: how agents hand control back",
    source: "Parley Journal",
    author: "Kasper Holm",
    summary:
      "Treats the handback as its own interaction with timing, a summary and undo. It offers three patterns with annotated screens.",
    why: "Names a gap in most agent products: the moment the person re-enters.",
  },
  {
    id: "1fd7093ce8a4",
    section: "research",
    headline: "Spring-based motion lowers perceived latency in touch interfaces",
    source: "Interaction Letters",
    author: "Okafor, Lindgren, Wu",
    summary:
      "In a study with 64 participants, springs read as more responsive than eased curves at identical durations. The effect held for drag release but not for button presses.",
    why: "Evidence for a choice usually made by feel, with a clear limit.",
  },
  {
    id: "e5093ab17c2d",
    section: "research",
    headline: "How people read while audio plays",
    source: "Preprint Shelf",
    author: "Dalgaard, Mehta",
    summary:
      "Eye tracking with 30 readers shows synchronized text shortens re-reading but lengthens fixations on headlines. The authors suggest highlighting by paragraph, not by word.",
    why: "Sets how much highlighting a read-along view should do.",
  },
  {
    id: "8a6c2f4e1b90",
    section: "launches",
    headline: "Tessera, a patch-based design token editor, opens its beta",
    source: "Show HN",
    author: "tessera_dev",
    summary:
      "Tokens are edited as small patches reviewed like code, with a visual diff for color and spacing. The beta is free and exports to the W3C token format.",
    why: "A review workflow for tokens is missing from most design systems.",
  },
  {
    id: "2b5e9d70c3f8",
    section: "watch",
    headline: "Thirteen minutes on building a drawer that feels physical",
    source: "Craft Hours, video",
    author: "Wen Zhao",
    summary:
      "A screen-recorded build of a bottom drawer with velocity-aware snapping, mistakes included.",
    why: "Short enough for a coffee break, and it shows the debugging.",
  },
];

/* ------------------------------------------------------------------ timeline */

/** Words per second of narration at 1x, used to fake an audio timeline. */
const WORDS_PER_SECOND = 2.6;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

export function spokenText(item: SampleItem, isFirstInSection: boolean): string {
  const lead = isFirstInSection ? `${SECTION_TITLES[item.section]}. ` : "";
  return `${lead}${item.headline}. ${item.summary} ${item.why}`;
}

export interface TimelineItem {
  index: number;
  id: string;
  section: SectionSlug;
  startSec: number;
  endSec: number;
}

export interface Timeline {
  items: TimelineItem[];
  /** First item of each section, in order. */
  sections: Array<{ slug: SectionSlug; startSec: number; endSec: number; firstIndex: number }>;
  durationSec: number;
}

export function buildTimeline(items: readonly SampleItem[] = ITEMS): Timeline {
  const timelineItems: TimelineItem[] = [];
  const sections: Timeline["sections"] = [];
  const opening = 3.2;
  let cursor = opening;
  items.forEach((item, index) => {
    const previous = items[index - 1];
    const isFirst = !previous || previous.section !== item.section;
    const length = Math.max(8, wordCount(spokenText(item, isFirst)) / WORDS_PER_SECOND);
    const start = index === 0 ? 0 : cursor;
    cursor += length;
    timelineItems.push({
      index,
      id: item.id,
      section: item.section,
      startSec: start,
      endSec: cursor,
    });
    if (isFirst) {
      sections.push({ slug: item.section, startSec: start, endSec: cursor, firstIndex: index });
    } else {
      const open = sections.at(-1);
      if (open) open.endSec = cursor;
    }
  });
  return { items: timelineItems, sections, durationSec: Math.round(cursor) };
}

export function readMinutes(items: readonly SampleItem[] = ITEMS): number {
  const words = items.reduce(
    (sum, item) => sum + wordCount(`${item.headline} ${item.summary} ${item.why}`),
    0,
  );
  return Math.max(1, Math.round(words / 230));
}

/** A live clock. The colon gets a narrow fixed box, because tabular figures also widen it. */
export function clockHtml(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}<span class="colon">:</span>${String(safe % 60).padStart(2, "0")}`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ dates and archive */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function parseDate(id: string): Date {
  const [year, month, day] = id.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1));
}

/** "Wednesday 7 October", the voice's date form. */
export function longDate(id: string): string {
  const date = parseDate(id);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function monthName(id: string): string {
  return MONTHS[parseDate(id).getUTCMonth()] ?? "";
}

export function dayNumber(id: string): number {
  return parseDate(id).getUTCDate();
}

export interface ArchiveEntry {
  id: string;
  kind: "regular" | "weekly";
  items: number;
  listenMinutes: number;
}

const entry = (
  id: string,
  items: number,
  listenMinutes: number,
  kind: ArchiveEntry["kind"] = "regular",
): ArchiveEntry => ({ id, kind, items, listenMinutes });

/** Newest first. The current digest (2026-10-07) is the page itself, not an archive row. */
export const ARCHIVE: readonly ArchiveEntry[] = [
  entry("2026-10-05", 11, 4),
  entry("2026-10-04-weekly", 17, 8, "weekly"),
  entry("2026-10-03", 12, 5),
  entry("2026-10-01", 10, 4),
  entry("2026-09-29", 12, 5),
  entry("2026-09-27-weekly", 18, 8, "weekly"),
  entry("2026-09-25", 9, 4),
  entry("2026-09-23", 11, 4),
  entry("2026-09-21", 12, 5),
  entry("2026-09-19", 10, 4),
  entry("2026-08-30-weekly", 16, 7, "weekly"),
  entry("2026-08-28", 12, 5),
  entry("2026-08-26", 8, 3),
  entry("2025-12-28-weekly", 15, 7, "weekly"),
  entry("2025-12-26", 10, 4),
  entry("2025-12-24", 7, 3),
  entry("2025-11-30-weekly", 18, 8, "weekly"),
  entry("2025-11-28", 11, 4),
];

export interface ArchiveMonth {
  key: string;
  label: string;
  entries: ArchiveEntry[];
}
export interface ArchiveYear {
  year: string;
  months: ArchiveMonth[];
}

export function groupArchive(entries: readonly ArchiveEntry[] = ARCHIVE): ArchiveYear[] {
  const years: ArchiveYear[] = [];
  for (const archived of entries) {
    const year = archived.id.slice(0, 4);
    const monthKey = archived.id.slice(0, 7);
    let yearGroup = years.find((group) => group.year === year);
    if (!yearGroup) {
      yearGroup = { year, months: [] };
      years.push(yearGroup);
    }
    let month = yearGroup.months.find((group) => group.key === monthKey);
    if (!month) {
      month = { key: monthKey, label: monthName(archived.id), entries: [] };
      yearGroup.months.push(month);
    }
    month.entries.push(archived);
  }
  return years;
}

/* ------------------------------------------------------------------ placeholder covers */

export interface CoverPalette {
  id: string;
  /** Block color. */
  bg: string;
  /** Numeral color. Chosen to clear 4.5:1 on bg. */
  fg: string;
  /** Key color the expanded player derives its accent from. */
  key: string;
}

/** Stand-ins for tokens/covers.json, which another agent owns. */
export const PALETTES: readonly CoverPalette[] = [
  { id: "dusk", bg: "oklch(34% 0.09 285)", fg: "oklch(96% 0.02 285)", key: "oklch(74% 0.13 330)" },
  { id: "tide", bg: "oklch(40% 0.09 232)", fg: "oklch(97% 0.015 232)", key: "oklch(78% 0.11 205)" },
  { id: "moss", bg: "oklch(38% 0.07 150)", fg: "oklch(97% 0.02 150)", key: "oklch(78% 0.14 130)" },
  { id: "lingon", bg: "oklch(44% 0.15 14)", fg: "oklch(97% 0.015 14)", key: "oklch(80% 0.1 14)" },
  { id: "saffron", bg: "oklch(84% 0.13 92)", fg: "oklch(26% 0.05 85)", key: "oklch(62% 0.14 92)" },
  { id: "slate", bg: "oklch(30% 0.03 250)", fg: "oklch(95% 0.01 250)", key: "oklch(76% 0.09 200)" },
];

export function paletteFor(id: string): CoverPalette {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTES[hash % PALETTES.length] ?? (PALETTES[0] as CoverPalette);
}

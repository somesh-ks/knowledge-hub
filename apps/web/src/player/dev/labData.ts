/**
 * Fixture digests for the dev lab. Invented content, a 90-second tone MP3 whose pitch steps up at
 * every item (so a seek is audible), and a real timeline, so the player can be exercised in a real
 * browser without the engine or the network.
 */
import type { PlayerDigestData } from "../../types/contracts";
import cover512 from "./lab-cover-512.png?url";
import cover1024 from "./lab-cover-1024.png?url";
// ?url keeps these plain strings. Astro turns a bare image import into an ImageMetadata object.
import audioUrl from "./lab-narration.mp3?url";

export interface LabItem {
  id: string;
  headline: string;
  section: PlayerDigestData["items"][number]["section"];
  source: string;
  author: string;
  summary: string;
  why: string;
}

const SECONDS_PER_ITEM = 15;

export const LAB_ITEMS: readonly LabItem[] = [
  {
    id: "a1f3c9d2b401",
    headline: "Retargeting springs mid-flight keeps interrupted drawers smooth",
    section: "top",
    source: "Interface Details",
    author: "Tomás Rivera",
    summary:
      "A short write-up on carrying velocity into a new spring target when a drawer is grabbed during its close. The demo code is under forty lines.",
    why: "Copy the retargeting step for drawers and toasts.",
  },
  {
    id: "b2e4d0a3c512",
    headline: "A small model that routes tool calls in 40 milliseconds",
    section: "top",
    source: "Latent Notes",
    author: "Mira Okafor",
    summary:
      "A classifier replaces the planner call for routing. Median latency drops from 900 to 40 milliseconds on the published benchmark.",
    why: "Try it as a first pass before the large model.",
  },
  {
    id: "c3f5e1b4d623",
    headline: "The safe triangle, rebuilt with pointer events",
    section: "ui-craft",
    source: "Interface Details",
    author: "Tomás Rivera",
    summary:
      "Submenus stay open while the pointer travels toward them, using a triangle computed from the last two pointer positions.",
    why: "Swap it in for the hover-intent timers in menus.",
  },
  {
    id: "d4a6f2c5e734",
    headline: "Scroll-driven headers need a fallback, and here is the smallest one",
    section: "ui-craft",
    source: "Frontend Weekly",
    author: "Ines Carvalho",
    summary:
      "Animation timelines tied to scroll position now run in most browsers. The fallback is an intersection observer that flips one attribute.",
    why: "Ship the observer fallback beside the CSS.",
  },
  {
    id: "e5b7a3d6f845",
    headline:
      "Four measures for agent interfaces: first signal, correction cost, interruptions, recovery",
    section: "ai",
    source: "Agent Patterns",
    author: "Jonas Lindqvist",
    summary:
      "A framework for judging agent UIs by what the person sees early and how cheaply they can fix a wrong step.",
    why: "Use the correction-cost measure in your next review.",
  },
  {
    id: "f6c8b4e7a956",
    headline: "Reading speed on phones, measured in lines per second",
    section: "research",
    source: "HCI Letters",
    author: "Priya Raman",
    summary:
      "A controlled study of 120 readers finds line length matters less than line count per screen on small displays.",
    why: "Watch the line-count result before you change a measure.",
  },
];

const SECTION_TITLES: Record<LabItem["section"], string> = {
  top: "Top picks",
  "ui-craft": "Interaction craft",
  ai: "AI models and products",
  tech: "Tech releases",
  research: "Research",
  launches: "Launches",
  watch: "Watch and listen",
};

export type LabVariant = "today" | "older" | "preparing";

const COVER_KEY = "oklch(89% 0.17 122)";

function digestFor(variant: LabVariant): PlayerDigestData {
  const hasAudio = variant !== "preparing";
  const id = variant === "today" ? "2026-01-14" : variant === "older" ? "2026-01-12" : "2026-01-16";
  const items = LAB_ITEMS.map((item, index) => ({
    id: item.id,
    headline: item.headline,
    section: item.section,
    source: item.source,
    start_ms: hasAudio ? index * SECONDS_PER_ITEM * 1000 : null,
    end_ms: hasAudio ? (index + 1) * SECONDS_PER_ITEM * 1000 : null,
  }));
  const slugs = [...new Set(LAB_ITEMS.map((item) => item.section))];
  return {
    id,
    date: id,
    title:
      variant === "today"
        ? "Wednesday 14 January"
        : variant === "older"
          ? "Monday 12 January"
          : "Friday 16 January",
    kind: "regular",
    // The older digest reuses the file under another fragment, so the browser treats it as a
    // different source while the bytes stay cached.
    audio: hasAudio
      ? {
          url: variant === "older" ? `${audioUrl}#older` : audioUrl,
          duration_ms: LAB_ITEMS.length * SECONDS_PER_ITEM * 1000,
        }
      : null,
    timeline: hasAudio ? "marks" : null,
    items,
    sections: slugs.map((slug) => ({
      slug,
      title: SECTION_TITLES[slug],
      start_ms: hasAudio
        ? LAB_ITEMS.findIndex((item) => item.section === slug) * SECONDS_PER_ITEM * 1000
        : null,
    })),
    cover: { src512: cover512, src1024: cover1024, key: COVER_KEY },
    prev_id: variant === "today" ? "2026-01-12" : variant === "older" ? "2026-01-09" : "2026-01-14",
    next_id: variant === "older" ? "2026-01-14" : null,
  };
}

export function labDigest(variant: LabVariant): PlayerDigestData {
  return digestFor(variant);
}

export function labSectionTitle(slug: LabItem["section"]): string {
  return SECTION_TITLES[slug];
}

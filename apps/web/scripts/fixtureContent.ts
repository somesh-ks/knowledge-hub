import type { Category, DigestItem, Section } from "@singularity/core";

/**
 * Invented content for the fixture digests. Every name, project and study here is made up and every
 * link points at example.com. It follows config/voice.md: headline up to 12 words, summary up to 35
 * words in two sentences, why up to 18 words in one sentence.
 */

interface Seed {
  id: string;
  section: Section;
  category: Category;
  sourceType: DigestItem["source_type"];
  headline: string;
  source: string;
  author?: string;
  summary: string;
  why: string;
}

const POOL: readonly Seed[] = [
  {
    id: "3f2a9c1e5b07",
    section: "top",
    category: "css_canvas_motion_techniques",
    sourceType: "rss",
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
    category: "css_canvas_motion_techniques",
    sourceType: "rss",
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
    category: "ai_ux_interaction_patterns",
    sourceType: "rss",
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
    category: "ui_component_primitives",
    sourceType: "github",
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
    category: "design_engineering_craft",
    sourceType: "rss",
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
    category: "css_canvas_motion_techniques",
    sourceType: "rss",
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
    category: "frontier_model_releases",
    sourceType: "rss",
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
    category: "ai_ux_interaction_patterns",
    sourceType: "rss",
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
    category: "hci_empirical_research",
    sourceType: "crossref",
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
    category: "hci_empirical_research",
    sourceType: "arxiv",
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
    category: "developer_tool_launches",
    sourceType: "hn",
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
    category: "design_engineering_craft",
    sourceType: "youtube",
    headline: "Thirteen minutes on building a drawer that feels physical",
    source: "Craft Hours, video",
    author: "Wen Zhao",
    summary:
      "A screen-recorded build of a bottom drawer with velocity-aware snapping, mistakes included.",
    why: "Short enough for a coffee break, and it shows the debugging.",
  },
  {
    id: "f0a17c2d6b83",
    section: "top",
    category: "taste_and_design_philosophy",
    sourceType: "rss",
    headline: "Why a quiet interface needs one loud detail",
    source: "Margin Notes",
    author: "Elsa Brandt",
    summary:
      "An essay on spending visual emphasis in one place and keeping everything else flat. It walks through four shipped screens and what each would lose with a second focal point.",
    why: "A usable test for any screen: name the one thing that is allowed to shout.",
  },
  {
    id: "6d3b8e0f94a1",
    section: "top",
    category: "design_engineering_craft",
    sourceType: "rss",
    headline: "Measuring tap latency on a mid-range phone with a high-speed camera",
    source: "Frame by Frame",
    author: "Pia Sandberg",
    summary:
      "A rig built from a phone and a desk lamp counts frames between touch and pixel change. The post compares three popular drawer libraries.",
    why: "A method that fits on a desk and settles most latency arguments.",
  },
  {
    id: "c9e2d71b40f5",
    section: "ui-craft",
    category: "css_canvas_motion_techniques",
    sourceType: "rss",
    headline: "Anchor positioning replaces a thousand lines of tooltip code",
    source: "Frontier CSS",
    author: "Linnea Berg",
    summary:
      "Popovers anchor to their trigger with plain CSS and flip when they run out of room. The article lists the three cases that still need script.",
    why: "A short list of what to delete from an existing popover helper.",
  },
  {
    id: "4a7f19c3e0d6",
    section: "ui-craft",
    category: "ui_component_primitives",
    sourceType: "github",
    headline: "Cobalt Kit ships an accessible combobox with virtual focus",
    source: "Cobalt Kit releases",
    author: "Cobalt maintainers",
    summary:
      "The combobox keeps focus in the input while arrow keys move a virtual cursor through options. It passes the screen reader matrix the team publishes.",
    why: "A reference for the keyboard model, whatever library is in use.",
  },
  {
    id: "b13c58a0f7e2",
    section: "ai",
    category: "ai_ux_interaction_patterns",
    sourceType: "exa",
    headline: "Streaming text that does not jump: three layout tricks for chat",
    source: "Parley Journal",
    author: "Ines Roca",
    summary:
      "Reserves line height, uses a stable scroll anchor and snaps code blocks into place once closed. Each trick comes with a short demo.",
    why: "Fixes the layout shift that makes long answers hard to read while they arrive.",
  },
  {
    id: "92d0e4b6a1c7",
    section: "research",
    category: "hci_empirical_research",
    sourceType: "arxiv",
    headline: "Audio summaries of articles raise recall for headlines but not details",
    source: "Preprint Shelf",
    author: "Nyberg, Abara",
    summary:
      "Forty listeners and forty readers answered questions a day later. Listeners recalled more headlines and fewer figures.",
    why: "Argues for keeping numbers in the text and the story in the voice.",
  },
  {
    id: "e8b5a3d02f14",
    section: "launches",
    category: "developer_tool_launches",
    sourceType: "producthunt",
    headline: "Gridwork, a visual regression tool that diffs motion frames",
    source: "Launch Board",
    author: "gridwork_team",
    summary:
      "Captures a strip of frames per interaction and flags changes in easing, not only in end state. A free tier covers one project.",
    why: "Motion regressions are rarely caught by screenshot tests, and this targets them.",
  },
  {
    id: "5f60c2e9b8a3",
    section: "launches",
    category: "developer_tool_launches",
    sourceType: "github",
    headline: "Plume 3 adds a plugin API for token transforms",
    source: "Plume releases",
    author: "Plume maintainers",
    summary:
      "Transforms run as small pure functions registered per platform. The release notes include a codemod for the old config.",
    why: "Worth reading for the plugin boundary, even without using the tool.",
  },
  {
    id: "0c7a91d5e4b2",
    section: "watch",
    category: "taste_and_design_philosophy",
    sourceType: "youtube",
    headline: "A forty minute conversation on taste in small teams",
    source: "Small Teams, podcast",
    author: "Hanna Lund",
    summary:
      "Three designers describe how a team of five keeps a shared sense of quality without a style guide. The second half covers hiring.",
    why: "Good background listening for a walk.",
  },
  {
    id: "d4e8f1a6c029",
    section: "watch",
    category: "design_engineering_craft",
    sourceType: "youtube",
    headline: "Rebuilding a native tab bar in CSS, start to finish",
    source: "Craft Hours, video",
    author: "Wen Zhao",
    summary:
      "A one hour build that covers safe areas, scroll snapping and a press state that feels native. The code is linked in the description.",
    why: "Useful as a checklist when auditing a bottom bar.",
  },
];

function pick(ids: readonly string[]): Seed[] {
  return ids.map((id) => {
    const seed = POOL.find((candidate) => candidate.id === id);
    if (!seed) throw new Error(`Unknown fixture item ${id}`);
    return seed;
  });
}

export const FIXTURE_ITEM_SETS = {
  /** The newest regular digest, with an audio timeline. */
  today: pick([
    "3f2a9c1e5b07",
    "a81d40c7e2b9",
    "5c0e7b93a1d4",
    "b27f6d18c409",
    "09e4a5d37f12",
    "d6a3182be5c0",
    "7e91c4f0a8b3",
    "c4b8e2a97d65",
    "1fd7093ce8a4",
    "e5093ab17c2d",
    "8a6c2f4e1b90",
    "2b5e9d70c3f8",
  ]),
  /** An older regular digest whose audio is still being prepared. */
  earlier: pick([
    "f0a17c2d6b83",
    "6d3b8e0f94a1",
    "c9e2d71b40f5",
    "4a7f19c3e0d6",
    "b13c58a0f7e2",
    "92d0e4b6a1c7",
    "e8b5a3d02f14",
    "0c7a91d5e4b2",
  ]),
  /** The weekly deep dive. */
  weekly: pick([
    "f0a17c2d6b83",
    "3f2a9c1e5b07",
    "6d3b8e0f94a1",
    "a81d40c7e2b9",
    "c9e2d71b40f5",
    "4a7f19c3e0d6",
    "b27f6d18c409",
    "b13c58a0f7e2",
    "7e91c4f0a8b3",
    "92d0e4b6a1c7",
    "1fd7093ce8a4",
    "e8b5a3d02f14",
    "5f60c2e9b8a3",
    "d4e8f1a6c029",
  ]),
} as const;

export function toDigestItems(seeds: readonly Seed[], publishedAt: string): DigestItem[] {
  return seeds.map((seed, index) => ({
    id: seed.id,
    section: seed.section,
    category: seed.category,
    source_type: seed.sourceType,
    headline: seed.headline,
    url: `https://example.com/singularity-fixture/${seed.id}`,
    source: seed.source,
    ...(seed.author ? { author: seed.author } : {}),
    summary: seed.summary,
    why: seed.why,
    score: Math.max(0.5, 0.95 - index * 0.03),
    published_at: publishedAt,
  }));
}

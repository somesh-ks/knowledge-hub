import { z } from "zod";
import {
  CATEGORIES,
  type Category,
  hasOwnAllowance,
  homeSection,
  IdString,
  isBuiltinCategory,
  NEVER_PUBLISH,
  SECTION_TITLES,
  SECTIONS,
  SectionId,
} from "./categories.js";
import type { Preferences } from "./preferences.js";

/**
 * How a topic is scored beyond fit. "craft" and "launch" multiply the fit by the same depth
 * factors the built-in categories use; "fit_only" scores on fit alone, which suits most custom
 * topics because the reader asked for a subject, not for technique.
 */
export const TOPIC_DEPTHS = ["craft", "launch", "fit_only"] as const;
export const TopicDepth = z.enum(TOPIC_DEPTHS);
export type TopicDepth = z.infer<typeof TopicDepth>;

export const TOPIC_ORIGINS = ["builtin", "custom"] as const;
export const TopicOrigin = z.enum(TOPIC_ORIGINS);
export type TopicOrigin = z.infer<typeof TopicOrigin>;

/** Ids a custom topic can never take: they mean something to the judge or to the layout. */
export const RESERVED_TOPIC_IDS: readonly string[] = ["none", "top", "watch"];

/** Judging a custom topic costs a model call per candidate, so the number of them is bounded. */
export const MAX_CUSTOM_TOPICS = 12;
export const MAX_KEYWORDS = 30;

const weight = z.number().min(0).max(1);

export const TopicSection = z.object({
  id: SectionId,
  title: z.string().trim().min(1).max(60),
  /** Position in the digest, ascending. Built-in sections keep their historical order. */
  order: z.number().int().nonnegative(),
});
export type TopicSection = z.infer<typeof TopicSection>;

export const Topic = z.object({
  /** Built-in topics use the category enum strings, so scoring and old digests keep their ids. */
  id: IdString,
  name: z.string().trim().min(1).max(60),
  /** What belongs in the topic. Read by the judge for a custom topic, so it should be concrete. */
  description: z.string().trim().min(1).max(400),
  /** 0 to 1. For a built-in topic the shipped value lives in config/preferences.json. */
  weight,
  enabled: z.boolean(),
  /** A candidate must contain one of these (or come from a tagged source) to be judged for a custom topic. */
  keywords: z.array(z.string().trim().min(1).max(60)).max(MAX_KEYWORDS),
  section_id: SectionId,
  never_publish: z.boolean(),
  origin: TopicOrigin,
  depth: TopicDepth,
});
export type Topic = z.infer<typeof Topic>;

/** Shape of config/topics.json. */
export const TopicsFile = z
  .object({
    version: z.literal(1),
    sections: z.array(TopicSection),
    topics: z.array(Topic),
  })
  .superRefine((file, ctx) => {
    const sectionIds = new Set<string>();
    for (const [index, section] of file.sections.entries()) {
      if (sectionIds.has(section.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["sections", index, "id"],
          message: `duplicate section id ${section.id}`,
        });
      }
      sectionIds.add(section.id);
    }
    const topicIds = new Set<string>();
    let custom = 0;
    for (const [index, topic] of file.topics.entries()) {
      const at = (field: string): (string | number)[] => ["topics", index, field];
      if (topicIds.has(topic.id)) {
        ctx.addIssue({ code: "custom", path: at("id"), message: `duplicate topic id ${topic.id}` });
      }
      topicIds.add(topic.id);
      if (!sectionIds.has(topic.section_id)) {
        ctx.addIssue({
          code: "custom",
          path: at("section_id"),
          message: `unknown section ${topic.section_id}`,
        });
      }
      if (topic.origin === "builtin") {
        if (!isBuiltinCategory(topic.id)) {
          ctx.addIssue({
            code: "custom",
            path: at("id"),
            message: `${topic.id} is not a built-in category`,
          });
        }
      } else {
        custom += 1;
        if (isBuiltinCategory(topic.id) || RESERVED_TOPIC_IDS.includes(topic.id)) {
          ctx.addIssue({
            code: "custom",
            path: at("id"),
            message: `${topic.id} is reserved for a built-in topic`,
          });
        }
      }
    }
    if (custom > MAX_CUSTOM_TOPICS) {
      ctx.addIssue({
        code: "custom",
        path: ["topics"],
        message: `at most ${MAX_CUSTOM_TOPICS} custom topics`,
      });
    }
  });
export type TopicsFile = z.infer<typeof TopicsFile>;

/** Section titles and order as they have always been. Order doubles as the digest order. */
export const BUILTIN_SECTIONS: readonly TopicSection[] = SECTIONS.map((id, order) => ({
  id,
  title: SECTION_TITLES[id],
  order,
}));

/** Name, description and depth of each built-in category. Weights come from the preferences. */
const BUILTIN_META: Record<Category, { name: string; description: string; depth: TopicDepth }> = {
  design_engineering_craft: {
    name: "Design engineering craft",
    description:
      "How an interface detail was built: implementation technique, craft process or a worked teardown of a polished UI.",
    depth: "craft",
  },
  hci_empirical_research: {
    name: "HCI research",
    description:
      "Human-computer interaction research with a method and results: user studies, experiments and papers on interaction techniques.",
    depth: "craft",
  },
  ui_component_primitives: {
    name: "UI components and primitives",
    description:
      "Accessible building blocks and component libraries such as dialog, popover, drawer, combobox and design tokens, including their releases.",
    depth: "craft",
  },
  ai_ux_interaction_patterns: {
    name: "AI interaction patterns",
    description:
      "Interface and interaction patterns for AI products: chat and agent interfaces, streaming, correction, interruption and generative UI.",
    depth: "craft",
  },
  css_canvas_motion_techniques: {
    name: "CSS, canvas and motion",
    description:
      "Concrete techniques in CSS, SVG, canvas, WebGL, shaders or animation, with code or a demo.",
    depth: "craft",
  },
  frontier_model_releases: {
    name: "Frontier model releases",
    description:
      "A release, model card, benchmark result or technical report for a frontier AI model.",
    depth: "craft",
  },
  developer_tool_launches: {
    name: "Developer tool launches",
    description:
      "A launch or major release of a developer tool, framework, library, editor, CLI or platform feature.",
    depth: "craft",
  },
  taste_and_design_philosophy: {
    name: "Taste and design philosophy",
    description:
      "Essays and talks about taste, craft, design principles and how to think about designing and building interfaces.",
    depth: "craft",
  },
  venture_capital_and_gossip: {
    name: "Venture capital and gossip",
    description:
      "Funding rounds, valuations, acquisitions, investor commentary and industry gossip.",
    depth: "fit_only",
  },
  generic_ai_hype_listicles: {
    name: "Generic AI hype",
    description:
      "Top-N tool lists, productivity promises and marketing language with no specific technique or finding.",
    depth: "fit_only",
  },
  consumer_tech_releases: {
    name: "Consumer tech releases",
    description:
      "Consumer technology releases and the news around them: phones, laptops, wearables, chips, operating systems and the rules that shape them.",
    depth: "launch",
  },
};

/** The built-in topics, in category order, with weights from the preferences. */
export function builtinTopics(weights: Readonly<Record<Category, number>>): Topic[] {
  return CATEGORIES.map((id): Topic => {
    const meta = BUILTIN_META[id];
    const section = homeSection(id, "rss");
    return {
      id,
      name: meta.name,
      description: meta.description,
      weight: weights[id],
      enabled: true,
      keywords: [],
      section_id: section ?? "top",
      never_publish: NEVER_PUBLISH.includes(id),
      origin: "builtin",
      depth: meta.depth,
    };
  });
}

/** What config/topics.json holds before anyone adds a topic: the built-ins and today's sections. */
export function seedTopicsFile(weights: Readonly<Record<Category, number>>): TopicsFile {
  return {
    version: 1,
    sections: BUILTIN_SECTIONS.map((section) => ({ ...section })),
    topics: builtinTopics(weights),
  };
}

/**
 * The topics a run works from. Built-in weights come from config/preferences.json, where
 * `dispatch learn` and the weight sliders write them, so the two files can never disagree about
 * the taste the score is computed from. Built-in topics missing from the file are restored. A
 * missing file reads as the seed.
 */
export function resolveTopics(
  file: TopicsFile | null | undefined,
  preferences: Pick<Preferences, "weights">,
): TopicsFile {
  const base = file ?? seedTopicsFile(preferences.weights);
  const seed = new Map(builtinTopics(preferences.weights).map((topic) => [topic.id, topic]));
  const present = new Set(base.topics.map((topic) => topic.id));
  const topics = base.topics.map((topic): Topic => {
    if (topic.origin !== "builtin") return topic;
    const fromPrefs = isBuiltinCategory(topic.id) ? preferences.weights[topic.id] : topic.weight;
    return { ...topic, weight: fromPrefs };
  });
  for (const [id, topic] of seed) if (!present.has(id)) topics.push(topic);
  const sections = [...base.sections];
  const haveSection = new Set(sections.map((section) => section.id));
  for (const section of BUILTIN_SECTIONS) {
    if (!haveSection.has(section.id)) sections.push({ ...section });
  }
  return { version: 1, sections, topics };
}

/** Custom topics that are switched on: the ones a run judges. */
export function activeCustomTopics(file: TopicsFile): Topic[] {
  return file.topics.filter((topic) => topic.origin === "custom" && topic.enabled);
}

/**
 * Home section for a category or topic id. A built-in category keeps the section it has always
 * had; a custom topic follows its `section_id`. Video goes to "watch" by source type. Null for a
 * topic that never publishes, and for an id nobody knows (a removed topic).
 */
export function homeSectionFor(
  topics: TopicsFile | null | undefined,
  id: string,
  sourceType: string,
): string | null {
  if (sourceType === "youtube") return "watch";
  if (isBuiltinCategory(id)) return homeSection(id, sourceType);
  const topic = topics?.topics.find((candidate) => candidate.id === id);
  if (!topic || topic.never_publish) return null;
  return topic.section_id;
}

/** True when an id publishes in a section of its own allowance (custom sections and Tech). */
export function ownsAllowance(
  topics: TopicsFile | null | undefined,
  id: string,
  sourceType: string,
): boolean {
  const home = homeSectionFor(topics, id, sourceType);
  return home !== null && hasOwnAllowance(home);
}

/** Sections in digest order. Ties on `order` keep file order. */
export function orderedTopicSections(file: TopicsFile): TopicSection[] {
  return file.sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => a.section.order - b.section.order || a.index - b.index)
    .map(({ section }) => section);
}

/** Lowercase id from a display name: letters and digits joined by underscores. */
export function topicIdFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug === "" ? "topic" : slug;
}

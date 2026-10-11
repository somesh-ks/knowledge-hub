import { z } from "zod";
import {
  CATEGORIES,
  type Category,
  DESIGN_TOPIC_ID,
  hasOwnAllowance,
  homeSection,
  IdString,
  isBuiltinCategory,
  isBuiltinSection,
  NEVER_PUBLISH,
  SECTION_TITLES,
  SECTIONS,
  SectionId,
  TRENDING_TOPIC_ID,
} from "./categories.js";
import { GENERAL_TOPICS, type GeneralTopicId, isGeneralTopicId } from "./generalTopics.js";
import type { Preferences } from "./preferences.js";

/**
 * How a topic is scored beyond fit. "craft" and "launch" multiply the fit by the same depth
 * factors the built-in categories use; "fit_only" scores on fit alone, which suits most custom
 * topics because the reader asked for a subject, not for technique. "coverage" multiplies by how
 * many distinct outlets reported the story (Trending, D40); a story one outlet carried scores 0.
 */
export const TOPIC_DEPTHS = ["craft", "launch", "fit_only", "coverage"] as const;
export const TopicDepth = z.enum(TOPIC_DEPTHS);
export type TopicDepth = z.infer<typeof TopicDepth>;

/**
 * "builtin" topics are the eleven judge categories. "custom" topics are the owner's. "app" topics
 * ship with the app (Design and Trending): judged by fit like a custom topic, but they can be
 * switched off and never removed, and they do not count toward MAX_CUSTOM_TOPICS. "general" topics
 * are the general news topics (World, Business, Science, Culture, Sports; D66): fed only by their
 * own news feeds, whose stories are judged so the feeds earn scores, and published only in
 * episodes, never in a briefing. Like app topics they can be renamed, reworded and switched off,
 * never removed, and do not count toward MAX_CUSTOM_TOPICS.
 */
export const TOPIC_ORIGINS = ["builtin", "custom", "app", "general"] as const;
export const TopicOrigin = z.enum(TOPIC_ORIGINS);
export type TopicOrigin = z.infer<typeof TopicOrigin>;

/** Ids a custom topic can never take: they mean something to the judge or to the layout. */
export const RESERVED_TOPIC_IDS: readonly string[] = [
  "none",
  "top",
  "watch",
  "technology",
  DESIGN_TOPIC_ID,
  TRENDING_TOPIC_ID,
  ...GENERAL_TOPICS.map((topic) => topic.id),
  // The pages of the owner's three topics (topicGroups.ts) take these ids.
  "ai",
  "tech",
];

/**
 * The section a general topic names. No digest has it: a general topic's stories go to episodes
 * only, so the briefing's selection never places them, and topics.json lists no such section.
 */
export const GENERAL_SECTION_ID = "general";

/** Ids of the topics that ship with the app. */
export const APP_TOPIC_IDS: readonly string[] = [DESIGN_TOPIC_ID, TRENDING_TOPIC_ID];

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
      if (
        topic.origin === "general"
          ? topic.section_id !== GENERAL_SECTION_ID
          : !sectionIds.has(topic.section_id)
      ) {
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
      } else if (topic.origin === "app") {
        if (!APP_TOPIC_IDS.includes(topic.id)) {
          ctx.addIssue({
            code: "custom",
            path: at("id"),
            message: `${topic.id} is not a topic that ships with the app`,
          });
        }
      } else if (topic.origin === "general") {
        if (!isGeneralTopicId(topic.id)) {
          ctx.addIssue({
            code: "custom",
            path: at("id"),
            message: `${topic.id} is not a general news topic`,
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

/**
 * The topics that ship with the app (D39). Each is judged by fit with the existing custom-topic
 * question, publishes in the section of the same id, and is fed by the sources tagged with its id.
 * The wording is part of the judge question's hash, so edit it only on purpose.
 */
export function appTopics(): Topic[] {
  return [
    {
      id: DESIGN_TOPIC_ID,
      name: "Design",
      description:
        "Product, UI, UX and visual design news and essays for a designer: interface and interaction design, usability research, design systems, branding and the craft and practice of design. Not architecture, furniture or interiors.",
      weight: 0.85,
      enabled: true,
      keywords: [],
      section_id: "design",
      never_publish: false,
      origin: "app",
      depth: "fit_only",
    },
    {
      id: TRENDING_TOPIC_ID,
      name: "Trending",
      description:
        "A news story that several major outlets are covering at once, in any field: politics, economy, science, health, technology, world events. Not sports results, celebrity gossip, obituaries of no wider interest, local crime, opinion columns or product reviews.",
      weight: 1,
      enabled: true,
      keywords: [],
      section_id: "trending",
      never_publish: false,
      origin: "app",
      depth: "coverage",
    },
  ];
}

/**
 * What counts as each general topic. Read by the judge as the topic's fit question, so its
 * sources earn quality scores; the wording is part of the question's hash, so edit it on purpose.
 */
const GENERAL_DESCRIPTIONS: Record<GeneralTopicId, string> = {
  world:
    "International news and world affairs: conflicts, diplomacy, elections and governments, disasters and humanitarian crises, and major events in any country.",
  business:
    "Business and economic news: markets, companies, earnings, deals, jobs, trade, prices, interest rates and the policies that move them.",
  science:
    "Science and health news: research findings, space, climate and the environment, medicine and public health, reported from a study or an expert.",
  culture:
    "Arts and culture news: film, television, music, books, art, games and the trends around them. Not sports results.",
  sports:
    "Sports news: results, tournaments, transfers, records and the stories around teams and athletes in major sports.",
};

/**
 * The general news topics (D66). Each is fed by the news feeds tagged with its id, ranked by how
 * many outlets carried a story, and names GENERAL_SECTION_ID, so a briefing never publishes it.
 */
export function generalTopics(): Topic[] {
  return GENERAL_TOPICS.map(
    ({ id, title }): Topic => ({
      id,
      name: title,
      description: GENERAL_DESCRIPTIONS[id],
      weight: 1,
      enabled: true,
      keywords: [],
      section_id: GENERAL_SECTION_ID,
      never_publish: false,
      origin: "general",
      depth: "coverage",
    }),
  );
}

/** What config/topics.json holds before anyone adds a topic: the built-ins and today's sections. */
export function seedTopicsFile(weights: Readonly<Record<Category, number>>): TopicsFile {
  return {
    version: 1,
    sections: BUILTIN_SECTIONS.map((section) => ({ ...section })),
    topics: [...builtinTopics(weights), ...appTopics(), ...generalTopics()],
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
  const seed = new Map(
    [...builtinTopics(preferences.weights), ...appTopics(), ...generalTopics()].map((topic) => [
      topic.id,
      topic,
    ]),
  );
  const present = new Set(base.topics.map((topic) => topic.id));
  const topics = base.topics.map((topic): Topic => {
    if (topic.origin !== "builtin") return topic;
    if (!isBuiltinCategory(topic.id)) return topic;
    // Weight is the owner's (preferences); the section follows the code, so a routing change
    // (D39) reaches a topics.json written before it.
    return {
      ...topic,
      weight: preferences.weights[topic.id],
      section_id: seed.get(topic.id)?.section_id ?? topic.section_id,
    };
  });
  for (const [id, topic] of seed) if (!present.has(id)) topics.push(topic);
  // Built-in sections take their title and order from the code, so a retitle reaches a file
  // written before it. A section a custom topic created is the owner's and is left alone.
  const sections = [
    ...BUILTIN_SECTIONS.map((section) => ({ ...section })),
    ...base.sections.filter((section) => !isBuiltinSection(section.id)),
  ];
  return { version: 1, sections, topics };
}

/** Custom topics that are switched on. */
export function activeCustomTopics(file: TopicsFile): Topic[] {
  return file.topics.filter((topic) => topic.origin === "custom" && topic.enabled);
}

/**
 * Topics a briefing judges by fit: the owner's custom topics and the app's own (Design, Trending),
 * when switched on. The built-in categories are judged by the fixed question set instead, and the
 * general topics only on their own feeds' stories (activeGeneralTopics).
 */
export function activeFitTopics(file: TopicsFile): Topic[] {
  return file.topics.filter(
    (topic) => topic.origin !== "builtin" && topic.origin !== "general" && topic.enabled,
  );
}

/** The general news topics that are switched on (D66). */
export function activeGeneralTopics(file: TopicsFile): Topic[] {
  return file.topics.filter((topic) => topic.origin === "general" && topic.enabled);
}

/** True when the id names a topic that ships with the app and the file has it switched off. */
export function isDisabledAppTopic(file: TopicsFile | null | undefined, id: string): boolean {
  if (!APP_TOPIC_IDS.includes(id)) return false;
  return file?.topics.find((topic) => topic.id === id)?.enabled === false;
}

/**
 * Home section for a category or topic id. A built-in category keeps the section it has always
 * had; a custom or app topic follows its `section_id`. Null for a topic that never publishes, and
 * for an id nobody knows (a removed topic). A video goes where its topic goes.
 */
export function homeSectionFor(
  topics: TopicsFile | null | undefined,
  id: string,
  sourceType: string,
): string | null {
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
